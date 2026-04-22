'use strict';
window.SignalingSocket = (() => {
  let ws            = null;
  let handlers      = {};
  let reconnTimer   = null;
  let reconnDelay   = 1500;
  let _url          = null;
  let _onOpen       = null;
  let _stopped      = false;

  function connect(url, onOpen) {
    _stopped   = false;
    _url       = url;
    _onOpen    = onOpen;
    reconnDelay = 1500;
    _open();
  }

  function _open() {
    if (_stopped) return;
    try { ws = new WebSocket(_url); } catch (e) {
      console.error('[ws] bad URL:', _url, e);
      return;
    }

    ws.onopen = () => {
      console.log('[ws] connected');
      reconnDelay = 1500;
      if (_onOpen) _onOpen();
    };

    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      const fn = handlers[m.type];
      if (fn) fn(m);
      else console.warn('[ws] unhandled:', m.type);
    };

    ws.onclose = (ev) => {
      if (_stopped) return;
      console.log('[ws] closed', ev.code, '— retry in', reconnDelay, 'ms');
      reconnTimer = setTimeout(() => {
        reconnDelay = Math.min(reconnDelay * 1.6, 12000);
        _open();
      }, reconnDelay);
    };

    ws.onerror = () => { /* onclose fires after onerror — let that handle retry */ };
  }

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  function on(type, fn)  { handlers[type] = fn; }

  function disconnect() {
    _stopped = true;
    clearTimeout(reconnTimer);
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
  }

  return { connect, send, on, disconnect };
})();
