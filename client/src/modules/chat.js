'use strict';
window.ChatModule = (() => {

  let _getMode, _getMyName, _getPeerNames;
  let _typTimer   = null;
  let _isTyping   = false;
  let _replyTo    = null;   // { id, text, sender } — currently quoted message
  let _msgs       = {};     // msgId → DOM element (for seen ticks)
  let _recorder   = null;   // MediaRecorder instance
  let _recChunks  = [];
  let _recTimer   = null;
  let _recSecs    = 0;
  let _recording  = false;

  /* ── helpers ── */
  const $msgs  = () => document.getElementById('chat-messages');
  const $input = () => document.getElementById('chat-input');
  const genId  = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  }
  function _senderName(pid) {
    if (!pid) return _getMyName ? _getMyName() : 'You';
    return (_getPeerNames?.()[pid]) || 'Peer';
  }
  function _send(payload) {
    const mode = _getMode?.() || 'p2p';
    if (mode === 'group') Channels.broadcastJSON(Channels.LABELS.CHAT, payload);
    else                  Channels.sendJSON(Channels.LABELS.CHAT, payload);
  }
  function _scrollBottom() {
    const el = $msgs();
    if (el) el.scrollTop = el.scrollHeight;
  }

  /* ════════════════════════════════════════════════════════════
     BUILD MESSAGE ELEMENT
  ════════════════════════════════════════════════════════════ */
  function _buildMsg({ id, dir, text, time, fromPeerId, replyTo, audioUrl, audioDur, isGroup }) {
    const el = document.createElement('div');
    el.className = `msg msg-${dir}`;
    el.dataset.msgId = id;
    if (dir === 'sys') { el.textContent = text; return el; }

    const ts = fmtTime(time);

    // ── Reply quote ──
    let replyHTML = '';
    if (replyTo) {
      replyHTML = `<div class="msg-reply-quote" data-reply-id="${esc(replyTo.id)}">
        <span class="msg-reply-sender">${esc(replyTo.sender)}</span>
        <span class="msg-reply-text">${esc((replyTo.text||'🎤 Voice note').slice(0,80))}</span>
      </div>`;
    }

    // ── Sender name (group in-message) ──
    const senderHTML = (dir === 'in' && isGroup)
      ? `<div class="msg-sender">${esc(_senderName(fromPeerId))}</div>` : '';

    // ── Body ──
    let bodyHTML = '';
    if (audioUrl) {
      bodyHTML = `<div class="msg-voice">
        <button class="voice-play-btn" data-audio="${audioUrl}">
          <svg class="voice-icon-play" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <svg class="voice-icon-pause hidden" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        </button>
        <div class="voice-waveform">${_makeWave()}</div>
        <span class="voice-dur">${audioDur || '0:00'}</span>
      </div>`;
    } else {
      bodyHTML = `<div class="msg-text">${esc(text)}</div>`;
    }

    // ── Meta (time + ticks) ──
    const ticksHTML = dir === 'out'
      ? `<span class="msg-ticks" data-state="sent">
          <svg class="tick-icon" width="14" height="9" viewBox="0 0 16 10" fill="none">
            <path d="M1 5l4 4L15 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>` : '';

    el.innerHTML = `
      ${senderHTML}
      ${replyHTML}
      ${bodyHTML}
      <div class="msg-meta">
        <span class="msg-time">${ts}</span>
        ${ticksHTML}
      </div>
      <button class="msg-reply-btn" title="Reply">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
      </button>`;

    // Wire reply button
    el.querySelector('.msg-reply-btn').addEventListener('click', () => {
      _setReply({
        id,
        text: text || '🎤 Voice note',
        sender: dir === 'out' ? (_getMyName?.() || 'You') : _senderName(fromPeerId),
      });
    });

    // Wire voice play
    if (audioUrl) {
      el.querySelector('.voice-play-btn')?.addEventListener('click', function() {
        _playVoice(this, audioUrl, el);
      });
    }

    return el;
  }

  function _makeWave() {
    // Generate a random waveform of 28 bars
    return Array.from({length:28}, (_,i) => {
      const h = 4 + Math.round(Math.random() * 14);
      return `<span class="wv-bar" style="height:${h}px"></span>`;
    }).join('');
  }

  /* ── Active audio player state ── */
  let _activeAudio = null;
  let _activeBtn   = null;

  function _playVoice(btn, url, msgEl) {
    // Stop previous
    if (_activeAudio && !_activeAudio.paused) {
      _activeAudio.pause();
      _activeBtn?.querySelector('.voice-icon-play').classList.remove('hidden');
      _activeBtn?.querySelector('.voice-icon-pause').classList.add('hidden');
      if (_activeBtn === btn) { _activeAudio = null; _activeBtn = null; return; }
    }
    const audio = new Audio(url);
    _activeAudio = audio;
    _activeBtn   = btn;
    btn.querySelector('.voice-icon-play').classList.add('hidden');
    btn.querySelector('.voice-icon-pause').classList.remove('hidden');

    // Animate waveform
    const bars = msgEl.querySelectorAll('.wv-bar');
    let animFrame;
    function animateBars() {
      if (audio.paused || audio.ended) return;
      bars.forEach(b => {
        const h = 4 + Math.round(Math.random()*14);
        b.style.height = h+'px';
      });
      animFrame = requestAnimationFrame(animateBars);
    }
    audio.play();
    animateBars();

    audio.onended = () => {
      cancelAnimationFrame(animFrame);
      btn.querySelector('.voice-icon-play').classList.remove('hidden');
      btn.querySelector('.voice-icon-pause').classList.add('hidden');
      _activeAudio = null; _activeBtn = null;
    };
    audio.onerror = () => { UI.toast('Could not play voice note','error'); };
  }

  /* ════════════════════════════════════════════════════════════
     REPLY BAR
  ════════════════════════════════════════════════════════════ */
  function _setReply(r) {
    _replyTo = r;
    const bar = document.getElementById('reply-bar');
    if (!bar) return;
    bar.classList.remove('hidden');
    bar.querySelector('.reply-bar-sender').textContent = r.sender;
    bar.querySelector('.reply-bar-text').textContent   = (r.text||'').slice(0,80);
    $input()?.focus();
  }

  function _clearReply() {
    _replyTo = null;
    document.getElementById('reply-bar')?.classList.add('hidden');
  }

  /* ════════════════════════════════════════════════════════════
     SEEN TICKS
  ════════════════════════════════════════════════════════════ */
  function _markSeen(msgId) {
    const el = _msgs[msgId];
    if (!el) return;
    const ticks = el.querySelector('.msg-ticks');
    if (!ticks) return;
    // Double tick (seen) — replace SVG with double tick
    ticks.dataset.state = 'seen';
    ticks.innerHTML = `<svg width="18" height="9" viewBox="0 0 22 10" fill="none">
      <path d="M1 5l4 4L15 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M6 5l4 4L20 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  function _sendSeenAck(msgId) {
    _send({ type: 'seen', msgId });
  }

  /* ════════════════════════════════════════════════════════════
     APPEND MESSAGE (public API)
  ════════════════════════════════════════════════════════════ */
  function appendMessage(text, dir, time, fromPeerId, extra) {
    if (dir === 'sys') {
      const el = document.createElement('div');
      el.className = 'msg msg-sys';
      el.textContent = text;
      $msgs().appendChild(el);
      _scrollBottom();
      return;
    }
    const id      = extra?.id || genId();
    const isGroup = _getMode?.() === 'group';
    const el = _buildMsg({ id, dir, text, time: time||Date.now(), fromPeerId, replyTo: extra?.replyTo, audioUrl: extra?.audioUrl, audioDur: extra?.audioDur, isGroup });
    $msgs().appendChild(el);
    _msgs[id] = el;
    _scrollBottom();
    return id;
  }

  function appendSystem(text) { appendMessage(text, 'sys'); }

  /* ════════════════════════════════════════════════════════════
     SEND TEXT
  ════════════════════════════════════════════════════════════ */
  function _sendText() {
    const txt = $input()?.value.trim();
    if (!txt) return;
    if (!Channels.isOpen(Channels.LABELS.CHAT)) { UI.toast('Not connected yet','error'); return; }

    const id      = genId();
    const time    = Date.now();
    const payload = { type:'msg', id, text:txt, time, replyTo: _replyTo || undefined };
    _send(payload);
    appendMessage(txt, 'out', time, null, { id, replyTo: _replyTo });
    $input().value = '';
    _clearReply();
    if (_isTyping) {
      _isTyping = false;
      _send({ type:'typing', value:false });
    }
  }

  /* ════════════════════════════════════════════════════════════
     VOICE NOTES
  ════════════════════════════════════════════════════════════ */
  function _fmtDur(secs) {
    return `${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`;
  }

  async function _startRecording() {
    if (_recording) return;
    if (!navigator.mediaDevices?.getUserMedia) { UI.toast('Mic not supported','error'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      const mr     = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
      _recorder  = mr;
      _recChunks = [];
      _recSecs   = 0;
      _recording = true;

      mr.ondataavailable = e => { if (e.data?.size) _recChunks.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        _onRecordingDone();
      };
      mr.start(100);

      // Update UI
      const btn = document.getElementById('btn-voice');
      if (btn) { btn.classList.add('recording'); btn.title = 'Stop recording'; }
      const ind = document.getElementById('voice-indicator');
      if (ind) { ind.classList.remove('hidden'); ind.querySelector('.vi-dur').textContent = '0:00'; }

      _recTimer = setInterval(() => {
        _recSecs++;
        const ind = document.getElementById('voice-indicator');
        if (ind) ind.querySelector('.vi-dur').textContent = _fmtDur(_recSecs);
        if (_recSecs >= 120) _stopRecording(); // max 2 min
      }, 1000);
    } catch(e) {
      UI.toast('Mic access denied','error');
    }
  }

  function _stopRecording() {
    if (!_recording || !_recorder) return;
    clearInterval(_recTimer);
    _recorder.stop();
    _recording = false;
    const btn = document.getElementById('btn-voice');
    if (btn) { btn.classList.remove('recording'); btn.title = 'Voice note'; }
    const ind = document.getElementById('voice-indicator');
    if (ind) ind.classList.add('hidden');
  }

  function _cancelRecording() {
    if (!_recording || !_recorder) return;
    clearInterval(_recTimer);
    _recorder.onstop = () => {}; // suppress normal handler
    _recorder.stream?.getTracks().forEach(t => t.stop());
    _recorder.stop();
    _recorder  = null;
    _recChunks = [];
    _recording = false;
    const btn = document.getElementById('btn-voice');
    if (btn) { btn.classList.remove('recording'); btn.title = 'Voice note'; }
    document.getElementById('voice-indicator')?.classList.add('hidden');
  }

  async function _onRecordingDone() {
    if (!_recChunks.length) return;
    const mime = _recChunks[0].type || 'audio/webm';
    const blob = new Blob(_recChunks, { type: mime });
    _recChunks  = [];

    // Convert to base64 to send over DataChannel
    const reader = new FileReader();
    reader.onloadend = () => {
      const b64  = reader.result; // data:audio/webm;base64,XXXXX
      const id   = genId();
      const dur  = _fmtDur(_recSecs);
      const time = Date.now();
      const payload = { type:'voice', id, audio:b64, dur, time, replyTo: _replyTo||undefined };

      if (!Channels.isOpen(Channels.LABELS.CHAT)) { UI.toast('Not connected','error'); return; }
      _send(payload);

      const url = URL.createObjectURL(blob);
      appendMessage(null, 'out', time, null, { id, audioUrl:url, audioDur:dur, replyTo:_replyTo });
      _clearReply();
    };
    reader.readAsDataURL(blob);
  }

  /* ════════════════════════════════════════════════════════════
     INCOMING MESSAGE HANDLER
  ════════════════════════════════════════════════════════════ */
  function _onMessage(raw, fromPeerId) {
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.type === 'msg') {
      const id = appendMessage(m.text, 'in', m.time, fromPeerId, { id:m.id, replyTo:m.replyTo });
      document.getElementById('typing-indicator').textContent = '';
      // Send seen ack
      if (m.id) _sendSeenAck(m.id);
    }
    else if (m.type === 'voice') {
      // Decode base64 back to blob URL
      let url = m.audio; // keep as data URL — works fine for playback
      appendMessage(null, 'in', m.time, fromPeerId, { id:m.id, audioUrl:url, audioDur:m.dur, replyTo:m.replyTo });
      if (m.id) _sendSeenAck(m.id);
    }
    else if (m.type === 'typing') {
      const name = _senderName(fromPeerId);
      document.getElementById('typing-indicator').textContent = m.value ? `${name} is typing…` : '';
    }
    else if (m.type === 'seen') {
      _markSeen(m.msgId);
    }
  }

  /* ════════════════════════════════════════════════════════════
     INIT
  ════════════════════════════════════════════════════════════ */
  function init(getMode, getMyName, getPeerNames) {
    _getMode      = getMode;
    _getMyName    = getMyName;
    _getPeerNames = getPeerNames;

    Channels.onMessage(Channels.LABELS.CHAT, _onMessage);

    // Send button
    document.getElementById('btn-send').addEventListener('click', _sendText);

    // Enter to send
    $input()?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendText(); return; }
      const mode = _getMode?.() || 'p2p';
      if (!_isTyping && Channels.isOpen(Channels.LABELS.CHAT)) {
        _isTyping = true;
        _send({ type:'typing', value:true });
      }
      clearTimeout(_typTimer);
      _typTimer = setTimeout(() => {
        _isTyping = false;
        if (Channels.isOpen(Channels.LABELS.CHAT)) _send({ type:'typing', value:false });
      }, 2000);
    });

    // Voice button — press & hold
    const vBtn = document.getElementById('btn-voice');
    if (vBtn) {
      // Touch devices: press & hold
      vBtn.addEventListener('mousedown',  () => _startRecording());
      vBtn.addEventListener('mouseup',    () => _stopRecording());
      vBtn.addEventListener('mouseleave', () => { if (_recording) _stopRecording(); });
      vBtn.addEventListener('touchstart', e => { e.preventDefault(); _startRecording(); });
      vBtn.addEventListener('touchend',   e => { e.preventDefault(); _stopRecording(); });
    }

    // Cancel recording
    document.getElementById('btn-voice-cancel')?.addEventListener('click', _cancelRecording);

    // Reply bar close
    document.getElementById('reply-bar-close')?.addEventListener('click', _clearReply);

    // IntersectionObserver for seen — mark as seen when message scrolls into view
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const el  = e.target;
        const id  = el.dataset.msgId;
        // If it's an incoming message, send seen ack (already done on receive — this is backup)
        io.unobserve(el);
      });
    }, { threshold: 0.8 });

    // Observe future messages
    const observer = new MutationObserver(muts => {
      muts.forEach(m => m.addedNodes.forEach(n => {
        if (n.nodeType === 1 && n.classList.contains('msg-in')) io.observe(n);
      }));
    });
    const msgs = $msgs();
    if (msgs) observer.observe(msgs, { childList: true });
  }

  return { init, appendSystem, appendMessage };
})();
