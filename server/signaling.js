// server/signaling.js — WebSocket signaling server
// Relays WebRTC handshake messages (SDP offers/answers, ICE candidates)
// between peers in the same room. Never sees actual data.

const { WebSocketServer } = require('ws');
const session = require('./session');
const { HEARTBEAT_INTERVAL_MS, ICE_SERVERS } = require('./config');

// ── Message helpers ───────────────────────────────────────────────────────────

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(peers, payload, excludeId) {
  for (const peer of peers) {
    if (peer.id !== excludeId) send(peer.ws, payload);
  }
}

// ── Message handlers ─────────────────────────────────────────────────────────

/**
 * join — a peer requests to enter a room.
 *   in:  { type:'join', roomId? }
 *   out: { type:'joined', roomId, peerId, iceServers, peerCount }
 *        { type:'peer_joined', peerId }  → to existing peers
 */
function handleJoin(ws, msg, state) {
  const roomId = msg.roomId || session.generateRoomId();
  const { peerId, error } = session.joinRoom(roomId, ws);

  if (error) {
    send(ws, { type: 'error', code: error, message: 'Room is full (max 2 peers).' });
    return;
  }

  state.peerId = peerId;
  state.roomId = roomId;

  // Tell the new peer their identity and room config
  send(ws, {
    type: 'joined',
    roomId,
    peerId,
    iceServers: ICE_SERVERS,
  });

  // Notify existing peers
  const others = session.getRoomPeers(peerId);
  broadcast(others, { type: 'peer_joined', peerId }, null);

  console.log(`[signal] ${peerId.slice(0,8)} joined room ${roomId.slice(0,8)} (${others.length + 1} peers)`);
}

/**
 * offer / answer / ice-candidate — standard WebRTC signaling messages.
 * We simply forward them to all other peers in the room.
 *   in:  { type:'offer'|'answer'|'ice-candidate', payload: <SDP or candidate> }
 *   out: same message + { from: peerId }  → to all other peers
 */
function handleRelay(ws, msg, state) {
  if (!state.peerId) {
    send(ws, { type: 'error', code: 'not_joined', message: 'Join a room first.' });
    return;
  }

  const others = session.getRoomPeers(state.peerId);
  if (others.length === 0) {
    // Peer arrived before the other side — they'll get the offer when they join
    return;
  }

  broadcast(others, { ...msg, from: state.peerId }, null);
}

/**
 * leave — graceful disconnect.
 */
function handleLeave(ws, state) {
  if (!state.peerId) return;
  const roomId = session.leaveRoom(state.peerId);
  const others = session.getRoomPeers(state.peerId); // already removed, so this is empty — but let's re-derive
  // Re-read from remaining peers in the room
  const room = roomId ? session.getOrCreateRoom(roomId).room : null;
  if (room) {
    for (const peer of room.peers.values()) {
      send(peer.ws, { type: 'peer_left', peerId: state.peerId });
    }
  }
  console.log(`[signal] ${state.peerId.slice(0,8)} left`);
  state.peerId = null;
  state.roomId = null;
}

// ── Main setup ────────────────────────────────────────────────────────────────

function setupSignaling(server) {
  const wss = new WebSocketServer({ server, path: '/signal' });

  wss.on('connection', (ws, req) => {
    // Per-connection mutable state (no shared globals per peer)
    const state = { peerId: null, roomId: null, alive: true };

    // ── Heartbeat ──────────────────────────────────────────────────────────
    ws.on('pong', () => { state.alive = true; });

    const hbTimer = setInterval(() => {
      if (!state.alive) { ws.terminate(); return; }
      state.alive = false;
      ws.ping();
    }, HEARTBEAT_INTERVAL_MS);

    // ── Incoming messages ──────────────────────────────────────────────────
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); }
      catch { send(ws, { type: 'error', code: 'bad_json', message: 'Invalid JSON.' }); return; }

      switch (msg.type) {
        case 'join':           handleJoin(ws, msg, state); break;
        case 'offer':
        case 'answer':
        case 'ice-candidate':  handleRelay(ws, msg, state); break;
        case 'leave':          handleLeave(ws, state); break;
        default:
          send(ws, { type: 'error', code: 'unknown_type', message: `Unknown message type: ${msg.type}` });
      }
    });

    // ── Cleanup on disconnect ──────────────────────────────────────────────
    ws.on('close', () => {
      clearInterval(hbTimer);
      handleLeave(ws, state);
    });

    ws.on('error', (err) => {
      console.error('[signal] WS error:', err.message);
    });

    console.log(`[signal] New connection from ${req.socket.remoteAddress}`);
  });

  // Ping sweep
  const sweep = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => clearInterval(sweep));

  console.log(`[signal] WebSocket signaling server ready on /signal`);
  return wss;
}

module.exports = { setupSignaling };
