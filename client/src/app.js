'use strict';
(async () => {
  const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signal`;
  let _mode      = 'p2p';
  let _myPeerId  = null;
  let _isInit    = false;
  let _connCount = 0;
  let _peerNames = {};
  let _myName    = 'You';
  let _roomId    = null;

  window._getMode     = () => _mode;
  window._getPeerName = (id) => _peerNames[id] || 'Peer';

  UI.initTabs();

  function updateNetMode() {
    UI.setMode(navigator.onLine ? 'Online' : 'LAN', navigator.onLine ? 'green' : 'yellow');
  }
  updateNetMode();
  window.addEventListener('online',  updateNetMode);
  window.addEventListener('offline', updateNetMode);

  // ── Clean leave ONLY on intentional disconnect, NOT on refresh ───────────
  // We use sessionStorage to flag when the user explicitly clicked Disconnect.
  // On refresh/tab-close the flag is absent, so no leave is sent.
  // The server's WebSocket 'close' event still calls handleLeave() automatically
  // when the connection drops (refresh, tab close, network loss), so peers are
  // notified regardless — we just don't want to double-fire or reset the room.
  function _sendLeave() {
    if (sessionStorage.getItem('ss-intentional-leave') === '1') {
      SignalingSocket.send({ type: 'leave' });
      try { navigator.sendBeacon('/api/leave', '{}'); } catch (_) {}
    }
  }
  window.addEventListener('pagehide', _sendLeave); // iOS Safari / bfcache

  // ── Signaling ──────────────────────────────────────────────────────────────

  SignalingSocket.on('joined', async (msg) => {
    _myPeerId = msg.peerId;
    _mode     = msg.mode || 'p2p';
    _roomId   = msg.roomId;
    RTCManager.init(msg.peerId, msg.iceServers, _mode);
    console.log(`[app] joined room=${msg.roomId} mode=${_mode} peers=${msg.peers?.length}`);

    const existing = msg.peers || [];

    if (_mode === 'group') {
      // ── FULL MESH, no glare: ONLY the lower UUID creates the offer ──────────
      // Rule: for each pair (me, peer), whichever has the lexicographically
      // LOWER id sends the offer. This guarantees exactly one offer per pair.
      // Here: I just joined. For each existing peer, if MY id < their id → I offer.
      // If their id < mine → they will offer me via peer_joined (see below).
      for (const p of existing) {
        _peerNames[p.id] = p.name;
        if (_myPeerId < p.id) {
          console.log(`[app] I have lower ID — offering to existing ${p.id.slice(0,8)}`);
          await RTCManager.createOffer(p.id);
        } else {
          console.log(`[app] existing ${p.id.slice(0,8)} has lower ID — they will offer me`);
        }
      }
    } else if (_isInit) {
      // P2P host: offer to any existing peer (rare — usually room is empty on create)
      for (const p of existing) {
        _peerNames[p.id] = p.name;
        await RTCManager.createOffer(p.id);
      }
    }
    // P2P guest: waits for host's offer via 'offer' event
  });

  SignalingSocket.on('peer_joined', async (msg) => {
    _peerNames[msg.peerId] = msg.name || `Peer ${Object.keys(_peerNames).length + 1}`;
    UI.setPeerStatus(`${_peerNames[msg.peerId]} joining…`);
    UI.updatePeerList(_peerNames);

    if (_mode === 'group') {
      // ── FULL MESH: existing peer offers newcomer only if lower UUID ─────────
      // The newcomer (in their 'joined' handler) already offered us IF they
      // have lower id than us. We offer them only if WE have lower id.
      // Exactly one side creates the offer — no glare possible.
      if (_myPeerId < msg.peerId) {
        console.log(`[app] I have lower ID — offering newcomer ${msg.peerId.slice(0,8)}`);
        await RTCManager.createOffer(msg.peerId);
      } else {
        console.log(`[app] newcomer ${msg.peerId.slice(0,8)} has lower ID — they offered me`);
        // newcomer already sent offer in their 'joined' handler (their id < mine)
      }
    } else if (_isInit) {
      // P2P: host offers to guest
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
    console.log(`[app] CONNECTED peer=${peerId.slice(0,8)} name=${name} total=${_connCount}`);
    console.log(`[app] open channels:`, Channels.debug());
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
    // Flag intentional leave so _sendLeave (pagehide) doesn't fire again
    sessionStorage.setItem('ss-intentional-leave', '1');
    _connCount = 0;
    CallModule.hangup('disconnect');
    SignalingSocket.send({ type: 'leave' });
    RTCManager.closeAll();
    SignalingSocket.disconnect();
    Channels.reset();
    _peerNames = {};
    _roomId    = null;
    // Clear flag after a tick (navigation within same origin won't reload)
    setTimeout(() => sessionStorage.removeItem('ss-intentional-leave'), 500);
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
    // Skip landing page when coming from a QR scan or shared link
    UI.showScreen('connect-screen');
    document.getElementById('room-input').value = urlRoom;
    UI.showJoinPanel();
    setTimeout(() => joinRoom(urlRoom), 150);
  }
})();
