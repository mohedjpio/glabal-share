window.Channels = (() => {
  const _ch = {};      // label → RTCDataChannel
  const _fn = {};      // label → message handler

  function onMessage(label, fn) { _fn[label] = fn; }

  function _setup(ch) {
    const label = ch.label;

    // CRITICAL: set binaryType BEFORE any data arrives
    if (label === 'file') ch.binaryType = 'arraybuffer';

    ch.onopen  = () => { console.log('[ch] OPEN:', label, ch.readyState); };
    ch.onclose = () => { console.log('[ch] CLOSE:', label); };
    ch.onerror = (e) => { console.error('[ch] ERROR:', label, e); };
    ch.onmessage = (e) => {
      const handler = _fn[label];
      if (handler) handler(e.data);
      else console.warn('[ch] no handler for', label);
    };

    _ch[label] = ch;
  }

  // Called by initiator after createDataChannel
  function register(ch) { _setup(ch); }

  // Called by guest when ondatachannel fires
  function receive(ch) {
    _setup(ch);
    console.log('[ch] received channel:', ch.label);
  }

  function send(label, data) {
    const ch = _ch[label];
    if (!ch) { console.warn('[ch] send: channel not found:', label); return false; }
    if (ch.readyState !== 'open') { console.warn('[ch] send: not open:', label, ch.readyState); return false; }
    // Backpressure guard: wait if buffer is filling up
    if (ch.bufferedAmount > 4 * 1024 * 1024) { // 4MB threshold
      console.warn('[ch] buffer full, dropping chunk');
      return false;
    }
    ch.send(data);
    return true;
  }

  function sendJSON(label, obj) { return send(label, JSON.stringify(obj)); }

  function isOpen(label) {
    const ch = _ch[label];
    const open = !!(ch && ch.readyState === 'open');
    if (!open) console.log('[ch] isOpen check failed:', label, ch ? ch.readyState : 'not registered');
    return open;
  }

  function reset() {
    Object.keys(_ch).forEach(k => delete _ch[k]);
    console.log('[ch] all channels reset');
  }

  const LABELS = { CHAT: 'chat', FILE: 'file', CLIPBOARD: 'clipboard' };

  return { register, receive, onMessage, send, sendJSON, isOpen, reset, LABELS };
})();
