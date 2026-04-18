// src/app.js — SmartShare bootstrap

(async () => {
  const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signal`;
  let isInitiator = false;
  let _connected = false;

  UI.initTabs();

  function updateMode() {
    UI.setMode(navigator.onLine ? 'Online' : 'LAN mode', navigator.onLine ? 'green' : 'yellow');
  }
  updateMode();
  window.addEventListener('online', updateMode);
  window.addEventListener('offline', updateMode);

  // ── Signaling ─────────────────────────────────────────────────────────────

  SignalingSocket.on('joined', async (msg) => {
    console.log('[app] joined room', msg.roomId);
    RTCManager.init(msg.peerId, msg.iceServers);

    if (isInitiator) {
      Channels.register(RTCManager.createChannel(Channels.LABELS.CHAT));
      Channels.register(RTCManager.createChannel(Channels.LABELS.FILE));
      Channels.register(RTCManager.createChannel(Channels.LABELS.CLIPBOARD));
      await RTCManager.createOffer();
    }
  });

  SignalingSocket.on('peer_joined', async () => {
    UI.setPeerStatus('Peer found — connecting…');
    // BUG FIX: only initiator re-creates offer, and only once
    if (isInitiator && !_connected) {
      await RTCManager.createOffer();
    }
  });

  SignalingSocket.on('offer',         (msg) => RTCManager.handleOffer(msg.payload));
  SignalingSocket.on('answer',        (msg) => RTCManager.handleAnswer(msg.payload));
  SignalingSocket.on('ice-candidate', (msg) => RTCManager.handleIceCandidate(msg.payload));

  SignalingSocket.on('peer_left', () => {
    if (!_connected) return;
    _connected = false;
    UI.toast('Peer disconnected', 'error');
    ChatModule.appendSystem('Peer left the session.');
    UI.showScreen('connect-screen');
    UI.setPeerStatus('Waiting for peer…');
    Channels.reset();
  });

  SignalingSocket.on('error', (msg) => {
    UI.toast(msg.message || 'Server error', 'error');
  });

  // ── WebRTC events ─────────────────────────────────────────────────────────

  RTCManager.on('channel', (ch) => Channels.receive(ch));

  RTCManager.on('connected', () => {
    if (_connected) return; // guard duplicate fires (Safari)
    _connected = true;
    console.log('[app] P2P connected');
    UI.showScreen('app-screen');
    UI.toast('Connected — secure P2P link active');
    ChatModule.appendSystem('Connected. Start chatting!');
    document.getElementById('connected-label').textContent = 'Connected';
  });

  RTCManager.on('disconnected', () => {
    if (!_connected) return;
    _connected = false;
    UI.toast('Connection lost', 'error');
    Channels.reset();
    UI.showScreen('connect-screen');
  });

  // ── Create room ───────────────────────────────────────────────────────────

  document.getElementById('btn-create').addEventListener('click', async () => {
    isInitiator = true;
    _connected = false;
    const res = await fetch('/api/room', { method: 'POST' });
    const { roomId } = await res.json();

    await QRModule.generate(roomId);
    UI.setPeerStatus('Waiting for peer to scan…');

    SignalingSocket.connect(WS_URL, () => {
      SignalingSocket.send({ type: 'join', roomId });
    });
  });

  // ── Join room ─────────────────────────────────────────────────────────────

  function joinRoom(id) {
    isInitiator = false;
    _connected = false;
    // strip any URL prefix
    let roomId = id.trim();
    try {
      const u = new URL(roomId);
      roomId = u.searchParams.get('room') || roomId;
    } catch (_) {}

    if (!roomId) { UI.toast('Enter a room ID or URL', 'error'); return; }

    UI.setPeerStatus('Connecting…');
    SignalingSocket.connect(WS_URL, () => {
      SignalingSocket.send({ type: 'join', roomId });
    });
  }

  document.getElementById('btn-join').addEventListener('click', () => {
    joinRoom(document.getElementById('room-input').value);
  });

  document.getElementById('room-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom(document.getElementById('room-input').value);
  });

  // ── Disconnect ────────────────────────────────────────────────────────────

  document.getElementById('btn-disconnect').addEventListener('click', () => {
    _connected = false;
    SignalingSocket.send({ type: 'leave' });
    RTCManager.close();
    SignalingSocket.disconnect();
    Channels.reset();
    UI.showScreen('connect-screen');
  });

  // ── Init modules ──────────────────────────────────────────────────────────
  ChatModule.init();
  FilesModule.init();
  ClipboardModule.init();

  // ── Auto-join from QR scan ────────────────────────────────────────────────
  const urlRoom = QRModule.getRoomFromUrl();
  if (urlRoom) {
    document.getElementById('room-input').value = urlRoom;
    // Small delay so UI is ready
    setTimeout(() => joinRoom(urlRoom), 100);
  }
})();
