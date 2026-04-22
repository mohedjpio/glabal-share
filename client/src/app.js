'use strict';
(async () => {
  const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signal`;
  let _mode      = 'p2p';
  let _myPeerId  = null;
  let _isInit    = false;   // true = I created the room
  let _connCount = 0;
  let _peerNames = {};
  let _myName    = 'You';
  let _roomId    = null;    // remember for refresh reconnect

  window._getMode     = () => _mode;
  window._getPeerName = (id) => _peerNames[id] || 'Peer';

  UI.initTabs();

  // ── Network mode badge ────────────────────────────────────────────────────
  function updateNetMode() {
    UI.setMode(navigator.onLine ? 'Online' : 'LAN', navigator.onLine ? 'green' : 'yellow');
  }
  updateNetMode();
  window.addEventListener('online',  updateNetMode);
  window.addEventListener('offline', updateNetMode);

  // ── FIX 3: clean disconnect on page unload / refresh ─────────────────────
  function _sendLeave() {
    // Use sendBeacon so it fires even during page close
    const msg = JSON.stringify({ type: 'leave' });
    try {
      // sendBeacon to a dedicated endpoint is most reliable on unload
      navigator.sendBeacon('/api/leave', msg);
    } catch (_) {}
    // Also try the WS (may still be open during soft refresh)
    SignalingSocket.send({ type: 'leave' });
  }
  window.addEventListener('beforeunload', _sendLeave);
  window.addEventListener('pagehide',     _sendLeave); // iOS Safari

  // ── Signaling ──────────────────────────────────────────────────────────────

  SignalingSocket.on('joined', async (msg) => {
    _myPeerId = msg.peerId;
    _mode     = msg.mode || 'p2p';
    _roomId   = msg.roomId;
    RTCManager.init(msg.peerId, msg.iceServers, _mode);
    console.log(`[app] joined room=${msg.roomId} mode=${_mode} existingPeers=${msg.peers?.length}`);

    const existing = msg.peers || [];

    if (_mode === 'group') {
      // ── GROUP MESH FIX ────────────────────────────────────────────────────
      // Rule: the NEWCOMER (me, just joined) always creates offers to ALL
      // existing peers. Existing peers do nothing — they wait for my offer.
      // This is deterministic: one side always offers, no glare.
      for (const p of existing) {
        _peerNames[p.id] = p.name;
        await RTCManager.createOffer(p.id);
      }
    } else if (_isInit) {
      // P2P host: offer to the one existing peer (should be none at creation)
      for (const p of existing) {
        _peerNames[p.id] = p.name;
        await RTCManager.createOffer(p.id);
      }
    }
    // P2P guest: waits for host to offer
  });

  SignalingSocket.on('peer_joined', async (msg) => {
    _peerNames[msg.peerId] = msg.name || `Peer ${Object.keys(_peerNames).length + 1}`;
    UI.setPeerStatus(`${_peerNames[msg.peerId]} joining…`);
    UI.updatePeerList(_peerNames);

    if (_mode === 'group') {
      // ── GROUP MESH FIX ────────────────────────────────────────────────────
      // A new peer just joined. THEY will offer to ME (as per the rule above).
      // I do NOT create an offer — I wait for theirs.
      // Exception: if somehow I was here first with no peers, I was already waiting.
      // No action needed — the newcomer's 'joined' handler creates the offer.
      console.log(`[app] peer_joined ${msg.peerId.slice(0,8)} — waiting for their offer`);
    } else if (_isInit) {
      // P2P: host sends offer to the guest
      await RTCManager.createOffer(msg.peerId);
    }
  });

  SignalingSocket.on('offer', (msg) => {
    _peerNames[msg.from] = _peerNames[msg.from] || 'Peer';
    RTCManager.handleOffer(msg.payload, msg.from);
  });
  SignalingSocket.on('answer',        (msg) => RTCManager.handleAnswer(msg.payload, msg.from));
  SignalingSocket.on('ice-candidate', (msg) => RTCManager.handleIceCandidate(msg.payload, msg.from));
  SignalingSocket.on('call-signal',   (msg) => CallModule.handleSignal(msg.payload, msg.from));

  SignalingSocket.on('peer_left', (msg) => {
    const name = _peerNames[msg.peerId] || 'A peer';
    RTCManager.closePeer(msg.peerId);
    delete _peerNames[msg.peerId];
    _connCount = Math.max(0, _connCount - 1);
    UI.updatePeerList(_peerNames);
    UI.updateConnCount(_connCount);
    ChatModule.appendSystem(`${name} left the room.`);
    UI.toast(`${name} disconnected`, 'error');
    if (_mode === 'p2p' && _connCount === 0) {
      CallModule.hangup('peer_left');
      Channels.reset();
      UI.showScreen('connect-screen');
    }
  });

  SignalingSocket.on('error', (msg) => UI.toast(msg.message || 'Server error', 'error'));

  // ── WebRTC events ─────────────────────────────────────────────────────────

  RTCManager.on('channel', (ch, fromPeerId) => {
    console.log(`[app] channel label=${ch.label} peer=${fromPeerId.slice(0,8)}`);
    Channels.register(ch, fromPeerId);
  });

  RTCManager.on('track', (event, fromPeerId) => CallModule.onRemoteTrack(event, fromPeerId));

  RTCManager.on('peer_connected', (peerId) => {
    _connCount++;
    const name = _peerNames[peerId] || 'Peer';
    console.log(`[app] peer_connected peer=${peerId.slice(0,8)} name=${name} total=${_connCount}`);
    console.log(`[app] channels:`, Channels.debug());
    UI.updateConnCount(_connCount);
    UI.updatePeerList(_peerNames);
    if (_connCount === 1) {
      UI.showScreen('app-screen');
      UI.toast(_mode === 'group' ? `${name} joined` : 'Connected — secure P2P');
      ChatModule.appendSystem(_mode === 'group' ? `${name} joined.` : 'Connected. Start chatting!');
    } else {
      UI.toast(`${name} joined`);
      ChatModule.appendSystem(`${name} joined.`);
    }
  });

  RTCManager.on('peer_disconnected', (_pid) => { /* handled via peer_left */ });

  // ── Create room ───────────────────────────────────────────────────────────

  document.getElementById('btn-create').addEventListener('click', async () => {
    _isInit    = true;
    _connCount = 0;
    _myName    = document.getElementById('my-name-input')?.value.trim() || 'Host';

    const res = await fetch('/api/room', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ mode: _mode }),
    });
    const { roomId } = await res.json();

    await QRModule.generate(roomId, _mode);
    UI.setPeerStatus(_mode === 'group' ? 'Waiting for members…' : 'Waiting for peer to scan…');

    SignalingSocket.connect(WS_URL, () => {
      SignalingSocket.send({ type: 'join', roomId, mode: _mode, name: _myName });
    });
  });

  // ── Join room ─────────────────────────────────────────────────────────────

  function joinRoom(rawId) {
    _isInit    = false;
    _connCount = 0;
    _myName    = document.getElementById('my-name-input')?.value.trim() || 'Guest';

    let roomId = (rawId || '').trim();
    try {
      const u = new URL(roomId);
      const m = u.searchParams.get('mode');
      if (m === 'group' || m === 'p2p') _mode = m;
      roomId = u.searchParams.get('room') || roomId;
    } catch (_) {}

    if (!roomId) { UI.toast('Enter a room URL or ID', 'error'); return; }

    UI.setPeerStatus('Connecting…');
    SignalingSocket.connect(WS_URL, () => {
      SignalingSocket.send({ type: 'join', roomId, name: _myName });
    });
  }

  document.getElementById('btn-join').addEventListener('click', () =>
    joinRoom(document.getElementById('room-input').value));
  document.getElementById('room-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinRoom(document.getElementById('room-input').value);
  });

  // ── Disconnect ────────────────────────────────────────────────────────────

  function doDisconnect() {
    window.removeEventListener('beforeunload', _sendLeave);
    window.removeEventListener('pagehide',     _sendLeave);
    _connCount = 0;
    CallModule.hangup('disconnect');
    SignalingSocket.send({ type: 'leave' });
    RTCManager.closeAll();
    SignalingSocket.disconnect();
    Channels.reset();
    _peerNames = {};
    _roomId    = null;
    UI.showScreen('connect-screen');
    UI.showModeSelect();
  }

  document.getElementById('btn-disconnect')?.addEventListener('click', doDisconnect);
  document.getElementById('btn-disconnect-mob')?.addEventListener('click', doDisconnect);

  // ── Mode selection ────────────────────────────────────────────────────────

  document.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      _mode = card.dataset.mode;
      document.getElementById('create-section')?.classList.remove('hidden');
    });
  });

  // ── Init modules ──────────────────────────────────────────────────────────
  ChatModule.init(() => _mode, () => _myName, () => _peerNames);
  FilesModule.init(() => _mode);
  ClipboardModule.init();
  CallModule.init();

  // ── Auto-join from QR ────────────────────────────────────────────────────
  const urlRoom = QRModule.getRoomFromUrl();
  if (urlRoom) {
    document.getElementById('room-input').value = urlRoom;
    UI.showJoinPanel();
    setTimeout(() => joinRoom(urlRoom), 150);
  }
})();
