// src/webrtc/connection.js — RTCPeerConnection wrapper

window.RTCManager = (() => {
  let pc = null;
  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  const _callbacks = {};
  // Queue ICE candidates that arrive before remote description is set
  const _pendingCandidates = [];

  function on(event, fn) { _callbacks[event] = fn; }
  function emit(event, ...args) { if (_callbacks[event]) _callbacks[event](...args); }

  function init(peerId, servers) {
    if (servers && servers.length) iceServers = servers;
    _createConnection();
  }

  function _createConnection() {
    if (pc) { try { pc.close(); } catch(_) {} }
    _pendingCandidates.length = 0;

    pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) SignalingSocket.send({ type: 'ice-candidate', payload: candidate });
    };

    pc.onconnectionstatechange = () => {
      console.log('[rtc] state:', pc.connectionState);
      emit('statechange', pc.connectionState);
      if (pc.connectionState === 'connected')                             emit('connected');
      if (['disconnected','failed','closed'].includes(pc.connectionState)) emit('disconnected');
    };

    // BUG FIX: also listen to iceConnectionState for Safari compatibility
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        emit('connected');
      }
    };

    pc.ondatachannel = (e) => {
      console.log('[rtc] received channel:', e.channel.label);
      emit('channel', e.channel);
    };
  }

  async function createOffer() {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    SignalingSocket.send({ type: 'offer', payload: offer });
  }

  async function handleOffer(offer) {
    // BUG FIX: guard against wrong signaling state
    if (pc.signalingState !== 'stable') {
      console.warn('[rtc] handleOffer called in state:', pc.signalingState);
      return;
    }
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    // Flush queued candidates
    for (const c of _pendingCandidates) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(_) {}
    }
    _pendingCandidates.length = 0;
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    SignalingSocket.send({ type: 'answer', payload: answer });
  }

  async function handleAnswer(answer) {
    if (pc.signalingState !== 'have-local-offer') return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    // Flush queued candidates
    for (const c of _pendingCandidates) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(_) {}
    }
    _pendingCandidates.length = 0;
  }

  async function handleIceCandidate(candidate) {
    // BUG FIX: queue candidates if remote description not set yet
    if (!pc.remoteDescription) {
      _pendingCandidates.push(candidate);
      return;
    }
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
    catch (e) { console.warn('[rtc] ICE candidate error:', e.message); }
  }

  function createChannel(label, options = {}) {
    return pc.createDataChannel(label, { ordered: true, ...options });
  }

  function close() {
    if (pc) { try { pc.close(); } catch(_) {} pc = null; }
    _pendingCandidates.length = 0;
  }

  return {
    on, init, createOffer, createChannel,
    handleOffer, handleAnswer, handleIceCandidate, close,
    get state() { return pc ? pc.connectionState : 'closed'; },
  };
})();
