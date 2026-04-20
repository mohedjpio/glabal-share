'use strict';
window.CallModule = (() => {

  // ── State ──────────────────────────────────────────────────────────────────
  let _callType    = 'audio';  // 'audio' | 'video'
  let _state       = 'idle';   // idle | ringing_out | ringing_in | active
  let _localStream = null;
  let _remoteStreams= {};       // peerId → MediaStream
  let _muted       = false;
  let _camOff      = false;
  let _callTimer   = null;
  let _callSecs    = 0;
  let _callee      = null;
  let _caller      = null;
  let _ringIv      = null;
  let _ringCtx     = null;

  const $ = id => document.getElementById(id);

  // ── Permission check ───────────────────────────────────────────────────────
  function _isSecure() {
    return location.protocol === 'https:' ||
           location.hostname === 'localhost' ||
           location.hostname === '127.0.0.1' ||
           location.hostname.endsWith('.local');
  }

  async function _getMedia(video) {
    if (!_isSecure()) {
      UI.toast('Calls require HTTPS. Deploy to Railway/Render or use localhost.', 'error');
      return null;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      UI.toast('Your browser does not support media access.', 'error');
      return null;
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true },
        video: video ? { width:{ideal:1280}, height:{ideal:720}, facingMode:'user' } : false,
      });
    } catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        UI.toast('Permission denied. Allow mic' + (video ? '/camera' : '') + ' in browser settings.', 'error');
      } else if (e.name === 'NotFoundError') {
        UI.toast('No ' + (video ? 'camera/microphone' : 'microphone') + ' found.', 'error');
      } else if (e.name === 'NotReadableError') {
        UI.toast('Mic/camera already in use by another app.', 'error');
      } else {
        UI.toast('Media error: ' + e.message, 'error');
      }
      return null;
    }
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  function _setUI(state) {
    _state = state;
    const bar = $('call-bar');
    if (!bar) return;

    const isIdle     = state === 'idle';
    const isRingIn   = state === 'ringing_in';
    const isRingOut  = state === 'ringing_out';
    const isActive   = state === 'active';

    $('call-btn-audio')?.classList.toggle('hidden', !isIdle);
    $('call-btn-video')?.classList.toggle('hidden', !isIdle);
    $('call-btn-accept')?.classList.toggle('hidden', !isRingIn);
    $('call-btn-reject')?.classList.toggle('hidden', !isRingIn);
    $('call-btn-mute')?.classList.toggle('hidden', !isActive);
    $('call-btn-cam')?.classList.toggle('hidden', !(isActive && _callType==='video'));
    $('call-btn-end')?.classList.toggle('hidden', isIdle || isRingIn);

    const s = $('call-status');
    if (s) {
      if (isIdle)    s.textContent = '';
      if (isRingOut) s.textContent = 'Calling…';
      if (isRingIn)  s.textContent = `${_callerName()} is calling…`;
      if (isActive)  s.textContent = '00:00';
    }

    bar.classList.toggle('call-active',  isActive);
    bar.classList.toggle('call-ringing', isRingIn || isRingOut);

    // Show/hide video overlay
    const overlay = $('video-overlay');
    if (overlay) overlay.classList.toggle('hidden', !(isActive && _callType==='video'));
  }

  function _callerName() {
    return (window._getPeerName && _caller && window._getPeerName(_caller)) || 'Peer';
  }

  // ── Timer ──────────────────────────────────────────────────────────────────
  function _startTimer() {
    _callSecs = 0;
    _callTimer = setInterval(() => {
      _callSecs++;
      const m = String(Math.floor(_callSecs/60)).padStart(2,'0');
      const s = String(_callSecs%60).padStart(2,'0');
      const el = $('call-status');
      if (el) el.textContent = `${m}:${s}`;
    }, 1000);
  }
  function _stopTimer() { clearInterval(_callTimer); _callTimer=null; _callSecs=0; }

  // ── Track management ───────────────────────────────────────────────────────
  function _addLocalTracks(peerId) {
    if (!_localStream) return;
    const peers = peerId ? [peerId] : RTCManager.connectedPeers();
    for (const pid of peers) {
      const pc = RTCManager._pcs[pid];
      if (!pc) continue;
      pc.getSenders()
        .filter(s => s.track?.kind === 'audio' || s.track?.kind === 'video')
        .forEach(s => { try { pc.removeTrack(s); } catch(_) {} });
      _localStream.getTracks().forEach(t => pc.addTrack(t, _localStream));
    }
  }

  // Called from app.js on RTCManager 'track' event
  function onRemoteTrack(event, fromPeerId) {
    const track = event.track;
    if (!_remoteStreams[fromPeerId]) _remoteStreams[fromPeerId] = new MediaStream();
    _remoteStreams[fromPeerId].addTrack(track);

    if (track.kind === 'audio') {
      // Attach to audio element
      let el = document.querySelector(`audio[data-peer="${fromPeerId}"]`);
      if (!el) { el = document.createElement('audio'); el.autoplay=true; el.playsInline=true; el.setAttribute('data-peer', fromPeerId); document.body.appendChild(el); }
      el.srcObject = _remoteStreams[fromPeerId];
    }

    if (track.kind === 'video') {
      // Attach to remote video element in overlay
      const el = $('video-remote');
      if (el) {
        if (!el.srcObject) el.srcObject = new MediaStream();
        el.srcObject.addTrack(track);
        el.play().catch(()=>{});
      }
    }

    track.onended = () => _remoteStreams[fromPeerId]?.removeTrack(track);
  }

  // ── Local video preview ────────────────────────────────────────────────────
  function _showLocalVideo() {
    const el = $('video-local');
    if (el && _localStream) {
      el.srcObject = _localStream;
      el.muted = true;   // don't echo own audio
      el.play().catch(()=>{});
    }
  }

  // ── Signaling ──────────────────────────────────────────────────────────────
  function _sig(payload, toPeerId) {
    SignalingSocket.send({ type:'call-signal', payload, to: toPeerId || undefined });
  }

  async function _renegotiateAll() {
    const peers = _callee ? [_callee] : RTCManager.connectedPeers();
    for (const pid of peers) {
      const pc = RTCManager._pcs[pid];
      if (!pc) continue;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        SignalingSocket.send({ type:'offer', payload:offer, to:pid });
      } catch(e) { console.warn('[call] renegotiate failed', e); }
    }
  }

  // ── Start call ─────────────────────────────────────────────────────────────
  async function startCall(type, toPeerId) {
    if (_state !== 'idle') { UI.toast('Already in a call', 'error'); return; }
    _callType = type || 'audio';

    const stream = await _getMedia(_callType === 'video');
    if (!stream) return;
    _localStream = stream;

    if (_callType === 'video') _showLocalVideo();

    _callee = toPeerId || null;
    _setUI('ringing_out');
    _sig({ action:'ring', callType:_callType }, toPeerId);
    UI.toast(_callType === 'video' ? 'Video calling…' : 'Calling…');
    setTimeout(() => { if (_state==='ringing_out') hangup('no_answer'); }, 45000);
  }

  // ── Accept ─────────────────────────────────────────────────────────────────
  async function acceptCall() {
    if (_state !== 'ringing_in') return;

    const stream = await _getMedia(_callType === 'video');
    if (!stream) {
      _sig({ action:'reject', reason:'mic_denied' }, _caller);
      _setUI('idle'); return;
    }
    _localStream = stream;
    if (_callType === 'video') _showLocalVideo();

    _addLocalTracks(_caller);
    await _renegotiateAll();
    _sig({ action:'accept', callType:_callType }, _caller);
    _setUI('active');
    _startTimer();
    _playRing(false);
    UI.toast('Call connected');
  }

  // ── Hang up ────────────────────────────────────────────────────────────────
  function hangup(reason) {
    if (_state === 'idle') return;
    const wasActive = _state === 'active';
    const target = _callee || _caller;
    _sig({ action:'end', reason:reason||'hangup' }, target||undefined);
    _cleanup();
    _setUI('idle');
    if (wasActive)               UI.toast('Call ended');
    else if (reason==='no_answer')  UI.toast('No answer');
    else if (reason==='rejected')   UI.toast('Call declined');
  }

  function rejectCall() {
    if (_state !== 'ringing_in') return;
    _sig({ action:'reject' }, _caller);
    _cleanup(); _setUI('idle');
  }

  // ── Controls ───────────────────────────────────────────────────────────────
  function toggleMute() {
    if (!_localStream) return;
    _muted = !_muted;
    _localStream.getAudioTracks().forEach(t => { t.enabled = !_muted; });
    const btn = $('call-btn-mute');
    if (btn) {
      btn.classList.toggle('muted', _muted);
      btn.querySelector('.call-btn-label').textContent = _muted ? 'Unmute' : 'Mute';
    }
    UI.toast(_muted ? 'Muted' : 'Unmuted');
  }

  function toggleCamera() {
    if (!_localStream) return;
    _camOff = !_camOff;
    _localStream.getVideoTracks().forEach(t => { t.enabled = !_camOff; });
    const btn = $('call-btn-cam');
    if (btn) {
      btn.classList.toggle('cam-off', _camOff);
      btn.querySelector('.call-btn-label').textContent = _camOff ? 'Cam on' : 'Cam off';
    }
    UI.toast(_camOff ? 'Camera off' : 'Camera on');
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  function _cleanup() {
    _stopTimer(); _playRing(false);
    _localStream?.getTracks().forEach(t => t.stop());
    _localStream = null; _muted = false; _camOff = false;

    // Clear video elements
    const lv = $('video-local');   if (lv)  { lv.srcObject=null; }
    const rv = $('video-remote');  if (rv)  { rv.srcObject=null; }

    // Remove audio elements
    document.querySelectorAll('audio[data-peer]').forEach(a => { a.srcObject=null; a.remove(); });
    _remoteStreams = {};

    // Remove media senders from all PCs
    for (const pc of Object.values(RTCManager._pcs)) {
      pc.getSenders()
        .filter(s => s.track?.kind==='audio' || s.track?.kind==='video')
        .forEach(s => { try { pc.removeTrack(s); } catch(_) {} });
    }
    _callee = null; _caller = null;
  }

  // ── Handle incoming signal ─────────────────────────────────────────────────
  function handleSignal(msg, fromPeerId) {
    const { action, callType } = msg;

    if (action === 'ring') {
      if (_state !== 'idle') { _sig({ action:'reject', reason:'busy' }, fromPeerId); return; }
      _caller   = fromPeerId;
      _callType = callType || 'audio';
      _setUI('ringing_in');
      _playRing(true);
      return;
    }
    if (action === 'accept') {
      if (_state !== 'ringing_out') return;
      _addLocalTracks(fromPeerId);
      _renegotiateAll();
      _setUI('active'); _startTimer(); _playRing(false);
      UI.toast('Call connected');
      return;
    }
    if (action === 'reject') {
      if (_state === 'idle') return;
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

  // ── Ring tone ──────────────────────────────────────────────────────────────
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
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + 0.6);
      } catch(_) {}
    }
    beep();
    _ringIv = setInterval(beep, 1800);
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    $('call-btn-audio')?.addEventListener('click',  () => startCall('audio'));
    $('call-btn-video')?.addEventListener('click',  () => startCall('video'));
    $('call-btn-end')?.addEventListener('click',    () => hangup());
    $('call-btn-accept')?.addEventListener('click', () => acceptCall());
    $('call-btn-reject')?.addEventListener('click', () => rejectCall());
    $('call-btn-mute')?.addEventListener('click',   () => toggleMute());
    $('call-btn-cam')?.addEventListener('click',    () => toggleCamera());
    RTCManager.on('track', (event, fromPeerId) => onRemoteTrack(event, fromPeerId));
  }

  return { init, startCall, hangup, handleSignal, onRemoteTrack };
})();
