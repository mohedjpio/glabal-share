// server/session.js — in-memory session & room manager
// No database, no files. Everything lives in these Maps and dies with the process.

const { v4: uuidv4 } = require('uuid');
const { SESSION_TTL_MS, MAX_PEERS_PER_ROOM } = require('./config');

// rooms: Map<roomId, Room>
// Room = { id, peers: Map<peerId, PeerMeta>, createdAt, lastActivity }
// PeerMeta = { id, ws, joinedAt }
const rooms = new Map();

// Reverse lookup: peerId → roomId
const peerRoom = new Map();

// ── Helpers ─────────────────────────────────────────────────────────────────

function now() { return Date.now(); }

function createRoom(roomId) {
  const room = {
    id: roomId,
    peers: new Map(),
    createdAt: now(),
    lastActivity: now(),
  };
  rooms.set(roomId, room);
  return room;
}

function touch(room) {
  room.lastActivity = now();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a fresh room ID (used when the initiator doesn't specify one).
 */
function generateRoomId() {
  return uuidv4();
}

/**
 * Get or create a room by ID.
 * Returns { room, error } — error is a string if the room is full.
 */
function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) room = createRoom(roomId);
  if (room.peers.size >= MAX_PEERS_PER_ROOM) {
    return { room: null, error: 'room_full' };
  }
  return { room, error: null };
}

/**
 * Add a peer (WebSocket connection) to a room.
 * Returns the peerId assigned.
 */
function joinRoom(roomId, ws) {
  const { room, error } = getOrCreateRoom(roomId);
  if (error) return { peerId: null, error };

  const peerId = uuidv4();
  room.peers.set(peerId, { id: peerId, ws, joinedAt: now() });
  peerRoom.set(peerId, roomId);
  touch(room);

  return { peerId, error: null };
}

/**
 * Remove a peer from its room. Cleans up empty rooms automatically.
 */
function leaveRoom(peerId) {
  const roomId = peerRoom.get(peerId);
  if (!roomId) return null;

  const room = rooms.get(roomId);
  if (room) {
    room.peers.delete(peerId);
    touch(room);
    if (room.peers.size === 0) {
      rooms.delete(roomId);
    }
  }
  peerRoom.delete(peerId);
  return roomId;
}

/**
 * Get all peers in the same room as the given peer (excluding itself).
 */
function getRoomPeers(peerId) {
  const roomId = peerRoom.get(peerId);
  if (!roomId) return [];
  const room = rooms.get(roomId);
  if (!room) return [];
  return [...room.peers.values()].filter(p => p.id !== peerId);
}

/**
 * Get the room a peer belongs to.
 */
function getPeerRoom(peerId) {
  return peerRoom.get(peerId) || null;
}

/**
 * Return basic stats (useful for debugging).
 */
function stats() {
  return {
    rooms: rooms.size,
    peers: peerRoom.size,
  };
}

// ── TTL cleanup — sweep idle rooms every minute ──────────────────────────────
setInterval(() => {
  const cutoff = now() - SESSION_TTL_MS;
  for (const [id, room] of rooms) {
    if (room.lastActivity < cutoff) {
      // Close all WebSocket connections in the expired room
      for (const peer of room.peers.values()) {
        try { peer.ws.close(1001, 'session_expired'); } catch (_) {}
        peerRoom.delete(peer.id);
      }
      rooms.delete(id);
      console.log(`[session] Expired room ${id}`);
    }
  }
}, 60_000);

module.exports = { generateRoomId, getOrCreateRoom, joinRoom, leaveRoom, getRoomPeers, getPeerRoom, stats };
