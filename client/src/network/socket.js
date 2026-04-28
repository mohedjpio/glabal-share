'use strict';
window.SignalingSocket = (() => {
  let ws          = null;
  let handlers    = {};
  let reconnTimer = null;
  let reconnDelay = 1500;
  let _url        = null;
  let _onOpen     = null;
  let _stopped    = false;
  let _joined     = false;   // true once server confirms 'joined' — prevents duplicate joins on reconnect

  function connect(url, onOpen) {
    // Close any existing connection first
    if (ws) {
      ws.onclose = null; ws.onerror = null;
      try { ws.close(); } catch(_) {}
      ws = null;
    }
    clearTimeout(reconnTimer);
    _stopped    = false;
    _joined     = false;
    _url        = url;
    _onOpen     = onOpen;
    reconnDelay = 1500;
    _open();
  }

  function _open() {
    if (_stopped) return;
    try { ws = new WebSocket(_url); } catch(e) {
      console.error('[ws] bad URL:', _url, e); return;
    }

    ws.onopen = () => {
      console.log('[ws] connected');
      reconnDelay = 1500;
      if (_onOpen) _onOpen();
    };

    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      // Track joined state to prevent double-join on reconnect
      if (m.type === 'joined') _joined = true;
      const fn = handlers[m.type];
      if (fn) fn(m); else console.warn('[ws] unhandled:', m.type);
    };

    ws.onclose = (ev) => {
      if (_stopped) return;
      console.log('[ws] closed', ev.code, '— retry in', reconnDelay, 'ms');
      // Only auto-reconnect if we haven't successfully joined yet
      // Once joined, let the server heartbeat handle dead detection
      // to avoid ghost peer bug (double-join fills p2p room)
      if (_joined) {
        console.log('[ws] already joined — no auto-reconnect (avoid ghost peer)');
        return;
      }
      reconnTimer = setTimeout(() => {
        reconnDelay = Math.min(reconnDelay * 1.6, 12000);
        _open();
      }, reconnDelay);
    };

    ws.onerror = () => { /* onclose fires after */ };
  }

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload)); return true;
    }
    return false;
  }

  function on(type, fn) { handlers[type] = fn; }

  function disconnect() {
    _stopped = true;
    _joined  = false;
    clearTimeout(reconnTimer);
    if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); ws = null; }
  }

  function isConnected() { return ws?.readyState === WebSocket.OPEN; }

  return { connect, send, on, disconnect, isConnected };
})();
