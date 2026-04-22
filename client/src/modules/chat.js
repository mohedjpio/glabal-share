'use strict';
window.ChatModule = (() => {
  let _getMode, _getMyName, _getPeerNames;
  let _typTimer = null, _isTyping = false;

  function $msgs()  { return document.getElementById('chat-messages'); }
  function $input() { return document.getElementById('chat-input'); }

  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\n/g,'<br>');
  }

  function _senderName(fromPeerId) {
    if (!fromPeerId) return 'You';
    const names = _getPeerNames ? _getPeerNames() : {};
    return names[fromPeerId] || 'Peer';
  }

  function appendMessage(text, dir, time, fromPeerId) {
    const el  = document.createElement('div');
    const t   = time ? new Date(time) : new Date();
    const ts  = t.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    const isGroup = _getMode && _getMode() === 'group';

    el.className = 'msg ' + dir;
    if (dir === 'in' && isGroup) {
      el.innerHTML =
        `<div class="msg-sender">${esc(_senderName(fromPeerId))}</div>`+
        `<div>${esc(text)}</div><span class="msg-time">${ts}</span>`;
    } else if (dir !== 'sys') {
      el.innerHTML = `<div>${esc(text)}</div><span class="msg-time">${ts}</span>`;
    } else {
      el.textContent = text;
    }
    $msgs().appendChild(el);
    $msgs().scrollTop = $msgs().scrollHeight;
  }

  function appendSystem(text) { appendMessage(text, 'sys'); }

  function _send() {
    const txt = $input().value.trim();
    if (!txt) return;
    if (!Channels.isOpen(Channels.LABELS.CHAT)) { UI.toast('Not connected yet','error'); return; }

    const payload = { type:'msg', text:txt, time:Date.now() };
    const mode    = _getMode ? _getMode() : 'p2p';

    if (mode === 'group') {
      Channels.broadcastJSON(Channels.LABELS.CHAT, payload);
    } else {
      Channels.sendJSON(Channels.LABELS.CHAT, payload);
    }
    appendMessage(txt, 'out');
    $input().value = '';
    if (_isTyping) {
      _isTyping = false;
      const tp = { type:'typing', value:false };
      mode==='group' ? Channels.broadcastJSON(Channels.LABELS.CHAT, tp)
                     : Channels.sendJSON(Channels.LABELS.CHAT, tp);
    }
  }

  function init(getMode, getMyName, getPeerNames) {
    _getMode      = getMode;
    _getMyName    = getMyName;
    _getPeerNames = getPeerNames;

    Channels.onMessage(Channels.LABELS.CHAT, (raw, fromPeerId) => {
      const m = JSON.parse(raw);
      if (m.type==='msg') {
        appendMessage(m.text, 'in', m.time, fromPeerId);
        document.getElementById('typing-indicator').textContent='';
      } else if (m.type==='typing') {
        const name = _senderName(fromPeerId);
        document.getElementById('typing-indicator').textContent = m.value ? `${name} is typing…` : '';
      }
    });

    document.getElementById('btn-send').addEventListener('click', _send);
    $input().addEventListener('keydown', e => {
      if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); _send(); return; }
      const mode = _getMode ? _getMode() : 'p2p';
      if (!_isTyping && Channels.isOpen(Channels.LABELS.CHAT)) {
        _isTyping = true;
        const tp = { type:'typing', value:true };
        mode==='group' ? Channels.broadcastJSON(Channels.LABELS.CHAT, tp)
                       : Channels.sendJSON(Channels.LABELS.CHAT, tp);
      }
      clearTimeout(_typTimer);
      _typTimer = setTimeout(() => {
        _isTyping = false;
        if (Channels.isOpen(Channels.LABELS.CHAT)) {
          const tp = { type:'typing', value:false };
          const mode = _getMode ? _getMode() : 'p2p';
          mode==='group' ? Channels.broadcastJSON(Channels.LABELS.CHAT, tp)
                         : Channels.sendJSON(Channels.LABELS.CHAT, tp);
        }
      }, 2000);
    });
  }

  return { init, appendSystem };
})();
