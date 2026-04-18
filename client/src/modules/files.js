window.FilesModule = (() => {
  const CHUNK = 16 * 1024; // 16KB — safe for all browsers
  const _in   = {};        // incoming transfers

  // ── UI ────────────────────────────────────────────────────────────────────

  function $list() { return document.getElementById('transfer-list'); }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function fmt(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
    return (b/1048576).toFixed(2) + ' MB';
  }

  function mkItem(id, name, size, dir) {
    const el = document.createElement('div');
    el.className = 'transfer-item';
    el.id = 'ti-' + id;
    el.innerHTML =
      '<div class="ti-top"><span class="ti-name">' + esc(name) + '</span>'
      + '<span class="ti-dir ' + dir + '">' + (dir==='out'?'↑ Sending':'↓ Receiving') + '</span></div>'
      + '<div class="ti-sz">' + fmt(size) + '</div>'
      + '<div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>'
      + '<div class="ti-pct">0%</div>';
    $list().prepend(el);
    return el;
  }

  function setPct(el, pct) {
    el.querySelector('.progress-fill').style.width = Math.min(pct,100) + '%';
    el.querySelector('.ti-pct').textContent = pct >= 100 ? '✓ Done' : pct + '%';
  }

  function addSave(el, name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    a.className = 'ti-save';
    a.textContent = '↓ Save file';
    el.querySelector('.ti-dir').textContent = '↓ Received';
    el.querySelector('.ti-pct').textContent = '✓ Done';
    el.appendChild(a);
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  async function sendFile(file) {
    // Debug: log channel state
    console.log('[files] sendFile called, file:', file.name, file.size);
    console.log('[files] file channel open?', Channels.isOpen(Channels.LABELS.FILE));

    if (!Channels.isOpen(Channels.LABELS.FILE)) {
      UI.toast('Channel not ready — are you connected?', 'error');
      return;
    }

    const id     = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const total  = Math.ceil(file.size / CHUNK) || 1;
    const el     = mkItem(id, file.name, file.size, 'out');

    // 1. Send meta as JSON string
    Channels.sendJSON(Channels.LABELS.FILE, {
      type:'file-meta', transferId:id,
      name:file.name, size:file.size,
      totalChunks:total,
      mime:file.type || 'application/octet-stream'
    });

    // 2. Read whole file into memory
    let buf;
    try {
      buf = await file.arrayBuffer();
    } catch(e) {
      UI.toast('Cannot read file: ' + e.message, 'error');
      return;
    }

    // 3. Send chunks with backpressure handling
    for (let i = 0; i < total; i++) {
      if (!Channels.isOpen(Channels.LABELS.FILE)) {
        el.querySelector('.ti-pct').textContent = '✗ Lost connection';
        UI.toast('Lost connection during transfer', 'error');
        return;
      }

      const slice      = buf.slice(i * CHUNK, (i + 1) * CHUNK);
      const metaStr    = JSON.stringify({ type:'file-chunk', transferId:id, index:i });
      const metaBytes  = new TextEncoder().encode(metaStr);
      const out        = new Uint8Array(4 + metaBytes.length + slice.byteLength);
      new DataView(out.buffer).setUint32(0, metaBytes.length);
      out.set(metaBytes, 4);
      out.set(new Uint8Array(slice), 4 + metaBytes.length);

      // Retry if buffer is full
      let sent = false;
      for (let attempt = 0; attempt < 200 && !sent; attempt++) {
        sent = Channels.send(Channels.LABELS.FILE, out.buffer);
        if (!sent) await new Promise(r => setTimeout(r, 10));
      }
      if (!sent) {
        el.querySelector('.ti-pct').textContent = '✗ Buffer full';
        UI.toast('Transfer failed — buffer overflow', 'error');
        return;
      }

      setPct(el, Math.round(((i+1)/total)*100));

      // Yield every 10 chunks to keep UI alive
      if (i % 10 === 9) await new Promise(r => setTimeout(r, 0));
    }

    console.log('[files] send complete:', file.name);
  }

  // ── Receive ───────────────────────────────────────────────────────────────

  function onData(data) {
    if (data instanceof ArrayBuffer) {
      const dv      = new DataView(data);
      const mLen    = dv.getUint32(0);
      const mBytes  = new Uint8Array(data, 4, mLen);
      let meta;
      try { meta = JSON.parse(new TextDecoder().decode(mBytes)); }
      catch(e) { console.warn('[files] bad chunk header', e); return; }

      const chunk   = data.slice(4 + mLen);
      const tx      = _in[meta.transferId];
      if (!tx) { console.warn('[files] unknown transferId', meta.transferId); return; }

      tx.chunks[meta.index] = chunk;
      tx.got++;
      setPct(tx.el, Math.round((tx.got / tx.total) * 100));

      if (tx.got === tx.total) {
        const blob = new Blob(tx.chunks, { type: tx.mime });
        addSave(tx.el, tx.name, blob);
        UI.toast('Received: ' + tx.name);
        delete _in[meta.transferId];
      }
      return;
    }

    // String = JSON control message
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'file-meta') {
      const el = mkItem(msg.transferId, msg.name, msg.size, 'in');
      _in[msg.transferId] = {
        el, name:msg.name, mime:msg.mime,
        total:msg.totalChunks, got:0,
        chunks: new Array(msg.totalChunks)
      };
      UI.toast('Incoming: ' + msg.name + ' (' + fmt(msg.size) + ')');
    }
  }

  // ── Drop zone ─────────────────────────────────────────────────────────────

  function initDrop() {
    const zone  = document.getElementById('drop-zone');
    const input = document.getElementById('file-input');
    if (!zone || !input) return;

    // Drag events
    zone.addEventListener('dragenter', e => e.preventDefault());
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', e => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      [...(e.dataTransfer.files||[])].forEach(sendFile);
    });

    // Click: open picker — but NOT when clicking the label/input itself
    zone.addEventListener('click', e => {
      if (e.target.tagName === 'LABEL' || e.target.tagName === 'INPUT' || e.target.closest('label')) return;
      input.click();
    });

    input.addEventListener('change', () => {
      [...(input.files||[])].forEach(sendFile);
      input.value = '';
    });
  }

  function init() {
    Channels.onMessage(Channels.LABELS.FILE, onData);
    initDrop();
  }

  return { init, sendFile };
})();
