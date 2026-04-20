'use strict';
// RTCManager — mesh P2P + Group connections + audio/video tracks

window.RTCManager = (() => {
  let _iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  let _myPeerId   = null;
  let _mode       = 'p2p';
  const _cbs      = {};
  const _pcs      = {};      // realPeerId → RTCPeerConnection
  const _pending  = {};      // realPeerId → ICE candidates pending remote desc
  let _firedConnected = {};  // guard duplicate 'connected' fires per peer

  function on(ev, fn)     { _cbs[ev] = fn; }
  function emit(ev, ...a) { if (_cbs[ev]) _cbs[ev](...a); }

  function init(myPeerId, servers, mode) {
    _myPeerId = myPeerId;
    _mode     = mode || 'p2p';
    if (servers && servers.length) _iceServers = servers;
    Object.values(_pcs).forEach(pc => { try { pc.close(); } catch (_) {} });
    for (const k in _pcs)    delete _pcs[k];
    for (const k in _pending) delete _pending[k];
    _firedConnected = {};
  }

  function _getOrCreate(remotePeerId) {
    if (_pcs[remotePeerId]) return _pcs[remotePeerId];

    const pc = new RTCPeerConnection({ iceServers: _iceServers });
    _pcs[remotePeerId]    = pc;
    _pending[remotePeerId] = [];

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) SignalingSocket.send({ type: 'ice-candidate', payload: candidate, to: remotePeerId });
    };

    const checkConn = () => {
      const s = pc.connectionState || pc.iceConnectionState;
      if ((s === 'connected' || s === 'completed') && !_firedConnected[remotePeerId]) {
        _firedConnected[remotePeerId] = true;
        emit('peer_connected', remotePeerId);
      }
      if (s === 'disconnected' || s === 'failed' || s === 'closed') {
        delete _firedConnected[remotePeerId];
        emit('peer_disconnected', remotePeerId);
      }
    };
    pc.onconnectionstatechange    = checkConn;
    pc.oniceconnectionstatechange = checkConn;

    // Answerer receives data channels created by initiator
    pc.ondatachannel = (e) => {
      console.log(`[rtc] ondatachannel label=${e.channel.label} from=${remotePeerId.slice(0,8)}`);
      emit('channel', e.channel, remotePeerId);
    };

    pc.ontrack = (e) => emit('track', e, remotePeerId);

    return pc;
  }

  // Initiator: create data channels THEN offer
  async function createOffer(remotePeerId) {
    const pc = _getOrCreate(remotePeerId);

    // Create all 3 data channels before creating the offer
    ['chat', 'file', 'clipboard'].forEach(label => {
      const ch = pc.createDataChannel(label, { ordered: true });
      // Emit 'channel' so app.js registers them with Channels module
      emit('channel', ch, remotePeerId);
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    SignalingSocket.send({ type: 'offer', payload: offer, to: remotePeerId });
    console.log(`[rtc] sent offer to ${remotePeerId.slice(0,8)}`);
  }

  // Answerer: receive offer, send answer — data channels arrive via ondatachannel
  async function handleOffer(offer, fromPeerId) {
    const pc = _getOrCreate(fromPeerId);

    if (pc.signalingState !== 'stable') {
      console.warn(`[rtc] handleOffer in state ${pc.signalingState}, rolling back`);
      try { await pc.setLocalDescription({ type: 'rollback' }); } catch (_) { return; }
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    // Flush pending ICE candidates
    for (const c of (_pending[fromPeerId] || [])) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
    }
    _pending[fromPeerId] = [];

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    SignalingSocket.send({ type: 'answer', payload: answer, to: fromPeerId });
    console.log(`[rtc] sent answer to ${fromPeerId.slice(0,8)}`);
  }

  async function handleAnswer(answer, fromPeerId) {
    const pc = _pcs[fromPeerId];
    if (!pc || pc.signalingState !== 'have-local-offer') return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    for (const c of (_pending[fromPeerId] || [])) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
    }
    _pending[fromPeerId] = [];
  }

  async function handleIceCandidate(candidate, fromPeerId) {
    const pc = _pcs[fromPeerId];
    if (!pc || !pc.remoteDescription) {
      (_pending[fromPeerId] = _pending[fromPeerId] || []).push(candidate);
      return;
    }
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) {}
  }

  function closePeer(peerId) {
    const pc = _pcs[peerId];
    if (pc) { try { pc.close(); } catch (_) {} delete _pcs[peerId]; }
    delete _pending[peerId];
    delete _firedConnected[peerId];
  }

  function closeAll() { Object.keys(_pcs).forEach(closePeer); }

  function connectedPeers() { return Object.keys(_pcs); }

  return {
    on, init,
    createOffer, handleOffer, handleAnswer, handleIceCandidate,
    closePeer, closeAll, connectedPeers,
    _pcs,  // exposed for call.js
    get mode() { return _mode; },
  };
})();
