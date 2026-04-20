'use strict';
// Channels — manages named DataChannels across multiple peers (group mesh)
// Key: `${peerId}::${label}` in group mode, just `label` in p2p mode

window.Channels = (() => {
  const _ch  = {};   // key → RTCDataChannel
  const _fn  = {};   // label → (data, fromPeerId) => void

  const P2P = '__p2p__';

  function _key(peerId, label) { return `${peerId}::${label}`; }

  function onMessage(label, fn) { _fn[label] = fn; }

  function _setup(ch, peerId) {
    const label = ch.label;
    const key   = _key(peerId, label);
    if (label === 'file') ch.binaryType = 'arraybuffer';
    ch.onopen    = () => console.log(`[ch] OPEN  ${peerId.slice(0,6)}::${label}`);
    ch.onclose   = () => { console.log(`[ch] CLOSE ${peerId.slice(0,6)}::${label}`); delete _ch[key]; };
    ch.onerror   = e => console.error(`[ch] ERR   ${peerId.slice(0,6)}::${label}`, e);
    ch.onmessage = e => { const fn = _fn[label]; if (fn) fn(e.data, peerId); };
    _ch[key] = ch;
  }

  // Called by initiator
  function register(ch, peerId) { _setup(ch, peerId || P2P); }

  // Called by answerer via ondatachannel
  function receive(ch, peerId)  { _setup(ch, peerId || P2P); }

  // Send to one specific peer
  function sendTo(peerId, label, data) {
    const ch = _ch[_key(peerId, label)];
    if (!ch || ch.readyState !== 'open') return false;
    if (ch.bufferedAmount > 4 * 1024 * 1024) return false;
    ch.send(data);
    return true;
  }

  // Send to all connected peers (broadcast)
  function broadcast(label, data) {
    let sent = 0;
    for (const [key, ch] of Object.entries(_ch)) {
      if (!key.endsWith(`::${label}`)) continue;
      if (ch.readyState !== 'open') continue;
      ch.send(data);
      sent++;
    }
    return sent > 0;
  }

  // In p2p mode — send to the single peer (backwards compat)
  function send(label, data)     { return sendTo(P2P, label, data); }
  function sendJSON(label, obj)  { return send(label, JSON.stringify(obj)); }
  function broadcastJSON(label, obj) { return broadcast(label, JSON.stringify(obj)); }
  function sendToJSON(peerId, label, obj) { return sendTo(peerId, label, JSON.stringify(obj)); }

  function isOpen(label) {
    // Check if at least one channel with this label is open
    for (const [key, ch] of Object.entries(_ch)) {
      if (key.endsWith(`::${label}`) && ch.readyState === 'open') return true;
    }
    return false;
  }

  function isOpenTo(peerId, label) {
    const ch = _ch[_key(peerId, label)];
    return !!(ch && ch.readyState === 'open');
  }

  function openPeers(label) {
    return Object.entries(_ch)
      .filter(([k,ch]) => k.endsWith(`::${label}`) && ch.readyState==='open')
      .map(([k]) => k.split('::')[0]);
  }

  function reset() { for (const k in _ch) delete _ch[k]; }

  const LABELS = { CHAT:'chat', FILE:'file', CLIPBOARD:'clipboard' };

  return {
    register, receive, onMessage,
    send, sendJSON, sendTo, sendToJSON,
    broadcast, broadcastJSON,
    isOpen, isOpenTo, openPeers, reset,
    LABELS, P2P,
  };
})();
