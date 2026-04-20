'use strict';
window.CallModule = (() => {

  /* ── State ── */
  let _callType   = 'audio';
  let _state      = 'idle';
  let _local      = null;      // MediaStream (mic/cam)
  let _remotes    = {};        // peerId → MediaStream
  let _muted      = false;
  let _camOff     = false;
  let _timer      = null;
  let _secs       = 0;
  let _callee     = null;
  let _caller     = null;
  let _ringIv     = null;
  let _ringCtx    = null;
  let _controlsHideTimer = null;

  const $ = id => document.getElementById(id);

  /* ── Secure context check ── */
  function _isSecure() {
    return location.protocol === 'https:' ||
           ['localhost','127.0.0.1'].includes(location.hostname) ||
           location.hostname.endsWith('.local');
  }

  /* ── Get media with helpful errors ── */
  async function _getMedia(video) {
    if (!_isSecure()) {
      UI.toast('Calls require HTTPS. Deploy online or use localhost.', 'error'); return null;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      UI.toast('Your browser does not support media access.', 'error'); return null;
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true },
        video: video ? { width:{ideal:1280}, height:{ideal:720}, facingMode:'user' } : false,
      });
    } catch (e) {
      const msgs = {
        NotAllowedError:      `Allow ${video?'camera & ':''}microphone in browser settings.`,
        PermissionDeniedError:`Allow ${video?'camera & ':''}microphone in browser settings.`,
        NotFoundError:        `No ${video?'camera/':''}microphone found on this device.`,
        NotReadableError:     'Mic/camera is in use by another application.',
      };
      UI.toast(msgs[e.name] || 'Media error: ' + e.message, 'error');
      return null;
    }
  }

  /* ══════════════════════════════════════════════════════════
     UI STATE MACHINE
  ══════════════════════════════════════════════════════════ */
  function _peerName(id) {
    return (window._getPeerName && id && window._getPeerName(id)) || 'Peer';
  }

  function _setUI(state) {
    _state = state;
    const screen = $('call-screen');
    const bar    = $('call-bar');
    if (!screen || !bar) return;

    const isIdle    = state === 'idle';
    const isOut     = state === 'ringing_out';
    const isIn      = state === 'ringing_in';
    const isActive  = state === 'active';
    const isCall    = !isIdle;

    /* Show/hide fullscreen call screen */
    screen.classList.toggle('hidden', isIdle);
    /* Hide idle call bar when in call */
    bar.style.display = isIdle ? '' : 'none';

    /* Remote video / avatar */
    const remote  = $('video-remote');
    const avatar  = $('cs-avatar');
    const hasVideo = isActive && _callType === 'video' && remote?.srcObject?.getVideoTracks().length > 0;
    if (remote) remote.style.display  = hasVideo ? 'block' : 'none';
    if (avatar) avatar.classList.toggle('hidden', hasVideo);

    /* Ring screen */
    const ring = $('cs-ring-screen');
    if (ring) ring.classList.toggle('hidden', !(isOut || isIn));

    /* Controls dock */
    const ctrl = $('cs-controls');
    if (ctrl) ctrl.classList.toggle('hidden', !isActive);

    /* Timer */
    const timer = $('cs-timer');
    if (timer) timer.classList.toggle('hidden', !isActive);

    /* Top bar — peer name + subtitle */
    const peerNameEl = $('cs-peer-name');
    const subtitle   = $('cs-call-status');
    if (isOut || isIn) {
      const name = isOut ? _peerName(_callee) : _peerName(_caller);
      if (peerNameEl) peerNameEl.textContent = name;
      if (subtitle)   subtitle.textContent   = isOut ? 'Calling…' : 'Incoming call';
      /* Avatar name */
      const an = $('cs-avatar-name'); if (an) an.textContent = name;
      /* Ring screen */
      const rn = $('cs-ring-name');   if (rn) rn.textContent = name;
      const rs = $('cs-ring-status'); if (rs) rs.textContent = isOut ? 'Calling…' : (_callType==='video'?'Video call':'Voice call');
      /* Incoming actions */
      $('cs-ring-actions')?.classList.toggle('hidden', !isIn);
    }
    if (isActive) {
      const name = _peerName(_callee || _caller);
      if (peerNameEl) peerNameEl.textContent = name;
      if (subtitle)   subtitle.textContent   = _callType === 'video' ? 'Video call' : 'Voice call';
      if (avatar) { const an = $('cs-avatar-name'); if (an) an.textContent = name; }
    }

    /* PiP local video */
    const pip = $('video-local');
    if (pip) pip.style.display = (isActive && _callType === 'video') ? '' : 'none';
  }

  /* ── Show/hide controls on tap (video mode) ── */
  function _setupTapToReveal() {
    const screen = $('call-screen');
    if (!screen) return;
    screen.addEventListener('click', () => {
      if (_state !== 'active') return;
      const ctrl = $('cs-controls');
      const top  = document.querySelector('.cs-topbar');
      if (!ctrl) return;
      ctrl.style.opacity = '1'; ctrl.style.pointerEvents = 'auto';
      if (top) { top.style.opacity = '1'; top.style.pointerEvents = 'auto'; }
      clearTimeout(_controlsHideTimer);
      if (_callType === 'video') {
        _controlsHideTimer = setTimeout(() => {
          ctrl.style.opacity = '0'; ctrl.style.pointerEvents = 'none';
          if (top) { top.style.opacity = '0'; top.style.pointerEvents = 'none'; }
        }, 4000);
      }
    });
  }

  /* ── Timer ── */
  function _startTimer() {
    _secs = 0; $('cs-timer').textContent = '00:00';
    _timer = setInterval(() => {
      _secs++;
      const m = String(Math.floor(_secs/60)).padStart(2,'0');
      const s = String(_secs%60).padStart(2,'0');
      const el = $('cs-timer'); if (el) el.textContent = `${m}:${s}`;
    }, 1000);
  }
  function _stopTimer() { clearInterval(_timer); _timer = null; _secs = 0; }

  /* ── Track management ── */
  function _addLocalTracks(peerId) {
    if (!_local) return;
    const peers = peerId ? [peerId] : RTCManager.connectedPeers();
    for (const pid of peers) {
      const pc = RTCManager._pcs[pid];
      if (!pc) continue;
      pc.getSenders().filter(s => s.track?.kind==='audio'||s.track?.kind==='video')
        .forEach(s => { try { pc.removeTrack(s); } catch(_) {} });
      _local.getTracks().forEach(t => pc.addTrack(t, _local));
    }
  }

  function onRemoteTrack(event, fromPeerId) {
    const track = event.track;
    if (!_remotes[fromPeerId]) _remotes[fromPeerId] = new MediaStream();
    _remotes[fromPeerId].addTrack(track);

    if (track.kind === 'audio') {
      let el = document.querySelector(`audio[data-peer="${fromPeerId}"]`);
      if (!el) {
        el = document.createElement('audio');
        el.autoplay = true; el.playsInline = true;
        el.setAttribute('data-peer', fromPeerId);
        document.body.appendChild(el);
      }
      el.srcObject = _remotes[fromPeerId];
    }
    if (track.kind === 'video') {
      const el = $('video-remote');
      if (el) {
        if (!el.srcObject) el.srcObject = new MediaStream();
        el.srcObject.addTrack(track);
        el.style.display = 'block';
        $('cs-avatar')?.classList.add('hidden');
        el.play().catch(() => {});
      }
    }
    track.onended = () => _remotes[fromPeerId]?.removeTrack(track);
  }

  function _showLocal() {
    const el = $('video-local');
    if (el && _local) { el.srcObject = _local; el.muted = true; el.play().catch(()=>{}); }
  }

  /* ── Signaling ── */
  function _sig(payload, to) {
    SignalingSocket.send({ type:'call-signal', payload, to: to||undefined });
  }

  async function _renegotiate() {
    const peers = _callee ? [_callee] : RTCManager.connectedPeers();
    for (const pid of peers) {
      const pc = RTCManager._pcs[pid];
      if (!pc) continue;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        SignalingSocket.send({ type:'offer', payload:offer, to:pid });
      } catch(e) { console.warn('[call] renegotiate:', e); }
    }
  }

  /* ── Start call ── */
  async function startCall(type, toPeerId) {
    if (_state !== 'idle') { UI.toast('Already in a call', 'error'); return; }
    _callType = type || 'audio';

    const stream = await _getMedia(_callType === 'video');
    if (!stream) return;
    _local  = stream;
    _callee = toPeerId || null;

    if (_callType === 'video') _showLocal();
    _setUI('ringing_out');
    _sig({ action:'ring', callType:_callType }, toPeerId);
    _playRing(true);
    setTimeout(() => { if (_state === 'ringing_out') hangup('no_answer'); }, 45000);
  }

  /* ── Accept ── */
  async function acceptCall() {
    if (_state !== 'ringing_in') return;

    const stream = await _getMedia(_callType === 'video');
    if (!stream) {
      _sig({ action:'reject', reason:'mic_denied' }, _caller);
      _cleanup(); _setUI('idle'); return;
    }
    _local = stream;
    if (_callType === 'video') _showLocal();

    _addLocalTracks(_caller);
    await _renegotiate();
    _sig({ action:'accept', callType:_callType }, _caller);
    _setUI('active');
    _startTimer();
    _playRing(false);
    _revealControls();
    UI.toast('Call connected');
  }

  /* ── Hang up ── */
  function hangup(reason) {
    if (_state === 'idle') return;
    const wasActive = _state === 'active';
    _sig({ action:'end', reason:reason||'hangup' }, _callee||_caller||undefined);
    _cleanup(); _setUI('idle');
    if (wasActive)             UI.toast('Call ended');
    else if (reason==='no_answer') UI.toast('No answer');
    else if (reason==='rejected')  UI.toast('Call declined');
  }

  function rejectCall() {
    if (_state !== 'ringing_in') return;
    _sig({ action:'reject' }, _caller);
    _cleanup(); _setUI('idle');
  }

  /* ── Controls ── */
  function toggleMute() {
    if (!_local) return;
    _muted = !_muted;
    _local.getAudioTracks().forEach(t => { t.enabled = !_muted; });
    const btn = $('call-btn-mute');
    if (btn) {
      btn.classList.toggle('muted', _muted);
      btn.dataset.label = _muted ? 'Unmute' : 'Mute';
      btn.title = _muted ? 'Unmute' : 'Mute';
    }
    UI.toast(_muted ? 'Muted' : 'Unmuted');
  }

  function toggleCamera() {
    if (!_local) return;
    _camOff = !_camOff;
    _local.getVideoTracks().forEach(t => { t.enabled = !_camOff; });
    const btn = $('call-btn-cam');
    if (btn) {
      btn.classList.toggle('cam-off', _camOff);
      btn.dataset.label = _camOff ? 'Cam on' : 'Camera';
      btn.title = _camOff ? 'Camera on' : 'Camera off';
    }
    UI.toast(_camOff ? 'Camera off' : 'Camera on');
  }

  function _revealControls() {
    const ctrl = $('cs-controls');
    const top  = document.querySelector('.cs-topbar');
    if (!ctrl) return;
    ctrl.style.opacity = '1'; ctrl.style.pointerEvents = 'auto';
    if (top) { top.style.opacity = '1'; top.style.pointerEvents = 'auto'; }
    if (_callType === 'video') {
      clearTimeout(_controlsHideTimer);
      _controlsHideTimer = setTimeout(() => {
        ctrl.style.opacity = '0'; ctrl.style.pointerEvents = 'none';
        if (top) { top.style.opacity = '0'; top.style.pointerEvents = 'none'; }
      }, 5000);
    }
  }

  /* ── Cleanup ── */
  function _cleanup() {
    _stopTimer(); _playRing(false);
    clearTimeout(_controlsHideTimer);
    _local?.getTracks().forEach(t => t.stop());
    _local = null; _muted = false; _camOff = false;

    const lv = $('video-local');  if (lv)  { lv.srcObject = null; }
    const rv = $('video-remote'); if (rv)  { rv.srcObject = null; rv.style.display = 'none'; }
    document.querySelectorAll('audio[data-peer]').forEach(a => { a.srcObject = null; a.remove(); });
    _remotes = {};

    for (const pc of Object.values(RTCManager._pcs)) {
      pc.getSenders().filter(s => s.track?.kind==='audio'||s.track?.kind==='video')
        .forEach(s => { try { pc.removeTrack(s); } catch(_) {} });
    }
    _callee = null; _caller = null;
  }

  /* ── Handle incoming signal ── */
  function handleSignal(msg, fromPeerId) {
    const { action, callType } = msg;

    if (action === 'ring') {
      if (_state !== 'idle') { _sig({ action:'reject', reason:'busy' }, fromPeerId); return; }
      _caller = fromPeerId; _callType = callType || 'audio';
      _setUI('ringing_in'); _playRing(true); return;
    }
    if (action === 'accept') {
      if (_state !== 'ringing_out') return;
      _addLocalTracks(fromPeerId);
      _renegotiate();
      _setUI('active'); _startTimer(); _playRing(false); _revealControls();
      UI.toast('Call connected'); return;
    }
    if (action === 'reject') {
      _cleanup(); _setUI('idle'); _playRing(false);
      UI.toast('Call declined', 'error'); return;
    }
    if (action === 'end') {
      if (_state === 'idle') return;
      const wasActive = _state === 'active';
      _cleanup(); _setUI('idle'); _playRing(false);
      if (wasActive) { ChatModule.appendSystem('Call ended.'); UI.toast('Call ended'); }
      return;
    }
  }

  /* ── Ring tone ── */
  function _playRing(on) {
    clearInterval(_ringIv); _ringIv = null;
    if (_ringCtx) { try { _ringCtx.close(); } catch(_) {} _ringCtx = null; }
    if (!on) return;
    function beep() {
      try {
        const ctx  = new (window.AudioContext || window.webkitAudioContext)();
        _ringCtx   = ctx;
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = 480;
        gain.gain.setValueAtTime(0.22, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + 0.7);
      } catch (_) {}
    }
    beep();
    _ringIv = setInterval(beep, 2000);
  }

  /* ── Init ── */
  function init() {
    $('call-btn-audio')?.addEventListener('click',  () => startCall('audio'));
    $('call-btn-video')?.addEventListener('click',  () => startCall('video'));
    $('call-btn-end')?.addEventListener('click',    () => hangup());
    $('call-btn-accept')?.addEventListener('click', () => acceptCall());
    $('call-btn-reject')?.addEventListener('click', () => rejectCall());
    $('call-btn-mute')?.addEventListener('click',   () => toggleMute());
    $('call-btn-cam')?.addEventListener('click',    () => toggleCamera());
    RTCManager.on('track', (event, fromPeerId) => onRemoteTrack(event, fromPeerId));
    _setupTapToReveal();
    // Initially hide controls transition for smooth reveal
    const ctrl = $('cs-controls');
    if (ctrl) { ctrl.style.transition = 'opacity .3s'; }
    const top = document.querySelector('.cs-topbar');
    if (top) { top.style.transition = 'opacity .3s'; }
  }

  return { init, startCall, hangup, handleSignal, onRemoteTrack };
})();
