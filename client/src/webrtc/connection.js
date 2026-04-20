'use strict';
// RTCManager — mesh P2P + Group, data channels + voice call audio tracks

window.RTCManager = (() => {
  let _iceServers = [{ urls:'stun:stun.l.google.com:19302' }];
  let _myPeerId   = null;
  let _mode       = 'p2p';
  const _cbs      = {};
  const _pcs      = {};     // peerId → RTCPeerConnection  (exposed for call.js)
  const _pending  = {};     // peerId → pending ICE candidates

  function on(ev, fn)     { _cbs[ev] = fn; }
  function emit(ev, ...a) { if (_cbs[ev]) _cbs[ev](...a); }

  function init(myPeerId, servers, mode) {
    _myPeerId = myPeerId;
    _mode     = mode || 'p2p';
    if (servers && servers.length) _iceServers = servers;
    Object.values(_pcs).forEach(pc => { try { pc.close(); } catch(_) {} });
    for (const k in _pcs)    delete _pcs[k];
    for (const k in _pending) delete _pending[k];
  }

  function _getOrCreate(remotePeerId) {
    if (_pcs[remotePeerId]) return _pcs[remotePeerId];

    const pc = new RTCPeerConnection({ iceServers: _iceServers });
    _pcs[remotePeerId]     = pc;
    _pending[remotePeerId] = [];

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) SignalingSocket.send({ type:'ice-candidate', payload:candidate, to:remotePeerId });
    };

    const checkConn = () => {
      const s = pc.connectionState || pc.iceConnectionState;
      if (s==='connected'||s==='completed')                        emit('peer_connected',    remotePeerId);
      if (s==='disconnected'||s==='failed'||s==='closed')          emit('peer_disconnected', remotePeerId);
    };
    pc.onconnectionstatechange    = checkConn;
    pc.oniceconnectionstatechange = checkConn;

    pc.ondatachannel = (e) => emit('channel', e.channel, remotePeerId);

    // ── Audio tracks (voice call) ──────────────────────────────────────────
    pc.ontrack = (e) => emit('track', e, remotePeerId);

    return pc;
  }

  async function createOffer(remotePeerId) {
    const pc = _getOrCreate(remotePeerId);
    ['chat','file','clipboard'].forEach(label => {
      const ch = pc.createDataChannel(label, { ordered:true });
      emit('channel', ch, remotePeerId);
    });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    SignalingSocket.send({ type:'offer', payload:offer, to:remotePeerId });
  }

  async function handleOffer(offer, fromPeerId) {
    const pc = _getOrCreate(fromPeerId);
    if (pc.signalingState !== 'stable') {
      // Glare — roll back and retry
      try {
        await pc.setLocalDescription({ type:'rollback' });
      } catch(_) { return; }
    }
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    for (const c of _pending[fromPeerId]||[]) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(_) {}
    }
    _pending[fromPeerId] = [];
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    SignalingSocket.send({ type:'answer', payload:answer, to:fromPeerId });
  }

  async function handleAnswer(answer, fromPeerId) {
    const pc = _pcs[fromPeerId];
    if (!pc || pc.signalingState !== 'have-local-offer') return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    for (const c of _pending[fromPeerId]||[]) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(_) {}
    }
    _pending[fromPeerId] = [];
  }

  async function handleIceCandidate(candidate, fromPeerId) {
    const pc = _pcs[fromPeerId];
    if (!pc || !pc.remoteDescription) {
      (_pending[fromPeerId] = _pending[fromPeerId]||[]).push(candidate); return;
    }
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(_) {}
  }

  function closePeer(peerId) {
    const pc = _pcs[peerId];
    if (pc) { try { pc.close(); } catch(_) {} delete _pcs[peerId]; }
    delete _pending[peerId];
  }

  function closeAll() { Object.keys(_pcs).forEach(closePeer); }

  function connectedPeers() { return Object.keys(_pcs); }

  const P2P_ID = '__p2p__';
  function initP2P(myPeerId, servers) { init(myPeerId, servers, 'p2p'); }
  function createP2POffer()           { return createOffer(P2P_ID); }
  function handleP2POffer(offer)      { return handleOffer(offer, P2P_ID); }
  function handleP2PAnswer(answer)    { return handleAnswer(answer, P2P_ID); }
  function handleP2PIce(c)            { return handleIceCandidate(c, P2P_ID); }
  function createChannel(label) {
    return _getOrCreate(P2P_ID).createDataChannel(label, { ordered:true });
  }

  return {
    on, init, initP2P,
    createOffer, handleOffer, handleAnswer, handleIceCandidate,
    createP2POffer, handleP2POffer, handleP2PAnswer, handleP2PIce,
    createChannel, closePeer, closeAll, connectedPeers,
    P2P_ID,
    _pcs,   // exposed so call.js can add tracks directly
    get mode()  { return _mode; },
    get state() { const pc=_pcs[P2P_ID]; return pc?pc.connectionState:'closed'; },
  };
})();
