window.ChatModule = (() => {
  let _typTimer = null, _isTyping = false;

  function $msgs()  { return document.getElementById('chat-messages'); }
  function $input() { return document.getElementById('chat-input'); }
  function esc(s)   { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }

  function append(text, cls, time) {
    const el = document.createElement('div');
    el.className = 'msg ' + cls;
    if (cls === 'sys') {
      el.textContent = text;
    } else {
      const t = time ? new Date(time) : new Date();
      el.innerHTML = '<div>' + esc(text) + '</div><span class="msg-time">'
        + t.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) + '</span>';
    }
    $msgs().appendChild(el);
    $msgs().scrollTop = $msgs().scrollHeight;
  }

  function appendSystem(t) { append(t, 'sys'); }

  function _send() {
    const txt = $input().value.trim();
    if (!txt) return;
    if (!Channels.isOpen(Channels.LABELS.CHAT)) { UI.toast('Not connected yet','error'); return; }
    Channels.sendJSON(Channels.LABELS.CHAT, { type:'msg', text:txt, time:Date.now() });
    append(txt, 'out');
    $input().value = '';
    if (_isTyping) { _isTyping=false; Channels.sendJSON(Channels.LABELS.CHAT,{type:'typing',value:false}); }
  }

  function init() {
    Channels.onMessage(Channels.LABELS.CHAT, raw => {
      const m = JSON.parse(raw);
      if (m.type==='msg') { append(m.text,'in',m.time); document.getElementById('typing-indicator').textContent=''; }
      else if (m.type==='typing') { document.getElementById('typing-indicator').textContent = m.value ? 'Peer is typing…' : ''; }
    });
    document.getElementById('btn-send').addEventListener('click', _send);
    $input().addEventListener('keydown', e => {
      if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); _send(); return; }
      if (!_isTyping && Channels.isOpen(Channels.LABELS.CHAT)) {
        _isTyping=true; Channels.sendJSON(Channels.LABELS.CHAT,{type:'typing',value:true});
      }
      clearTimeout(_typTimer);
      _typTimer = setTimeout(()=>{ _isTyping=false; if(Channels.isOpen(Channels.LABELS.CHAT)) Channels.sendJSON(Channels.LABELS.CHAT,{type:'typing',value:false}); }, 2000);
    });
  }

  return { init, appendSystem };
})();
