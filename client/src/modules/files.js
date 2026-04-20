'use strict';
window.FilesModule = (() => {
  const CHUNK    = 16 * 1024;          // 16 KB per chunk
  const HIGH_WM  = 1 * 1024 * 1024;   // pause when buffer > 1 MB
  const LOW_WM   = 256 * 1024;        // resume when buffer < 256 KB
  const _in      = {};
  let _getMode;

  /* ── helpers ── */
  function $l()   { return document.getElementById('transfer-list'); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmt(b) { return b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':(b/1048576).toFixed(2)+' MB'; }

  function mkItem(id, name, size, dir) {
    const el = document.createElement('div');
    el.className = 'transfer-item'; el.id = 'ti-'+id;
    el.innerHTML =
      `<div class="ti-top">`+
        `<span class="ti-name" title="${esc(name)}">${esc(name)}</span>`+
        `<span class="ti-badge ${dir}">${dir==='out'?'↑ Sending':'↓ Receiving'}</span>`+
      `</div>`+
      `<div class="ti-meta">${fmt(size)}</div>`+
      `<div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>`+
      `<div class="ti-pct">0%</div>`;
    $l().prepend(el);
    return el;
  }
  function setPct(el, p) {
    el.querySelector('.progress-fill').style.width = Math.min(p,100)+'%';
    el.querySelector('.ti-pct').textContent = p>=100 ? '✓ Complete' : p+'%';
  }
  function setStatus(el, text, cls) {
    el.querySelector('.ti-pct').textContent = text;
    if (cls) el.querySelector('.ti-badge').className = `ti-badge ${cls}`;
  }
  function addSave(el, name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url; a.download=name; a.className='ti-save';
    a.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Save`;
    el.querySelector('.ti-badge').textContent = '✓ Received';
    el.querySelector('.ti-badge').className = 'ti-badge done';
    el.querySelector('.ti-pct').textContent = '✓ Complete';
    el.appendChild(a);
  }

  /* ── get the DataChannel object for a label ── */
  function _getChannel(label) {
    // Access internal _ch map in Channels to find the file channel
    // We go through the isOpen check first then use sendTo internals
    // Instead, expose a helper to get the raw channel
    const peers = Channels.openPeers(label);
    if (!peers.length) return null;
    // Return the first open channel's underlying DC via a helper
    return null; // we'll use event-driven approach below
  }

  /* ── event-driven send with proper backpressure ── */
  async function sendFile(file, toPeerId) {
    const label = Channels.LABELS.FILE;
    const mode  = _getMode ? _getMode() : 'p2p';
    if (!Channels.isOpen(label)) { UI.toast('Not connected', 'error'); return; }

    const id    = Date.now().toString(36) + Math.random().toString(36).slice(2,8);
    const total = Math.ceil(file.size / CHUNK) || 1;
    const el    = mkItem(id, file.name, file.size, 'out');

    /* Send metadata */
    const meta = { type:'file-meta', transferId:id, name:file.name,
                   size:file.size, totalChunks:total,
                   mime: file.type || 'application/octet-stream' };
    if (mode === 'group') {
      toPeerId ? Channels.sendToJSON(toPeerId, label, meta) : Channels.broadcastJSON(label, meta);
    } else {
      Channels.sendJSON(label, meta);
    }

    /* Read entire file once */
    let buf;
    try { buf = await file.arrayBuffer(); }
    catch(e) { setStatus(el,'✗ Cannot read file','err'); UI.toast('Cannot read file','error'); return; }

    /* Build all chunks upfront (avoids per-chunk allocation inside loop) */
    function buildChunk(i) {
      const slice    = buf.slice(i * CHUNK, (i+1) * CHUNK);
      const hdr      = JSON.stringify({ type:'file-chunk', transferId:id, index:i });
      const hdrBytes = new TextEncoder().encode(hdr);
      const out      = new Uint8Array(4 + hdrBytes.length + slice.byteLength);
      new DataView(out.buffer).setUint32(0, hdrBytes.length);
      out.set(hdrBytes, 4);
      out.set(new Uint8Array(slice), 4 + hdrBytes.length);
      return out.buffer;
    }

    /* Get the raw RTCDataChannel so we can use bufferedamountlow */
    // We need the actual DC — reach into Channels internals via a new helper
    // Get the actual peer ID to use for the raw channel
    const _peerId = toPeerId || Channels.openPeers(label)[0] || null;
    const dc = _peerId ? Channels.getRawChannel(label, _peerId) : null;
    if (!dc) { setStatus(el,'✗ Channel not found','err'); return; }
    dc.bufferedAmountLowThreshold = LOW_WM;

    let i = 0;
    let cancelled = false;

    async function pump() {
      while (i < total && !cancelled) {
        if (!Channels.isOpen(label)) {
          setStatus(el,'✗ Disconnected','err'); cancelled=true; return;
        }
        /* Backpressure: if buffer is full, wait for bufferedamountlow event */
        if (dc.bufferedAmount > HIGH_WM) {
          await new Promise(resolve => {
            const onLow   = () => { dc.removeEventListener('bufferedamountlow', onLow); resolve(); };
            dc.addEventListener('bufferedamountlow', onLow);
          });
        }
        dc.send(buildChunk(i));
        setPct(el, Math.round(((i+1)/total)*100));
        i++;
        /* Yield every 50 chunks to keep UI responsive */
        if (i % 50 === 0) await new Promise(r => setTimeout(r, 0));
      }
      if (!cancelled) setStatus(el, '✓ Complete', 'done');
    }

    await pump();
  }

  /* ── receive ── */
  function onData(data, fromPeerId) {
    if (data instanceof ArrayBuffer) {
      const dv   = new DataView(data);
      const mLen = dv.getUint32(0);
      let meta;
      try { meta = JSON.parse(new TextDecoder().decode(new Uint8Array(data,4,mLen))); }
      catch { return; }
      const chunk = data.slice(4 + mLen);
      const tx = _in[meta.transferId];
      if (!tx) return;
      tx.chunks[meta.index] = chunk; tx.got++;
      setPct(tx.el, Math.round((tx.got / tx.total)*100));
      if (tx.got === tx.total) {
        addSave(tx.el, tx.name, new Blob(tx.chunks, {type:tx.mime}));
        UI.toast('Received: ' + tx.name);
        delete _in[meta.transferId];
      }
      return;
    }
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'file-meta') {
      const el = mkItem(msg.transferId, msg.name, msg.size, 'in');
      _in[msg.transferId] = { el, name:msg.name, mime:msg.mime,
                              total:msg.totalChunks, got:0, chunks:[] };
      UI.toast('Incoming: ' + msg.name + ' (' + fmt(msg.size) + ')');
    }
  }

  /* ── drop zone ── */
  function initDrop() {
    const zone  = document.getElementById('drop-zone');
    const input = document.getElementById('file-input');
    if (!zone || !input) return;
    zone.addEventListener('dragenter', e => e.preventDefault());
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      [...(e.dataTransfer.files||[])].forEach(f => sendFile(f));
    });
    zone.addEventListener('click', e => {
      if (e.target.tagName==='LABEL'||e.target.tagName==='INPUT'||e.target.closest('label')) return;
      input.click();
    });
    input.addEventListener('change', () => {
      [...(input.files||[])].forEach(f => sendFile(f));
      input.value = '';
    });
  }

  function init(getMode) {
    _getMode = getMode;
    Channels.onMessage(Channels.LABELS.FILE, onData);
    initDrop();
  }

  return { init, sendFile };
})();
