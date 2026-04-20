'use strict';
window.FilesModule = (() => {
  const CHUNK = 16 * 1024;
  const _in   = {};
  let _getMode;

  function $list() { return document.getElementById('transfer-list'); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmt(b) { return b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':(b/1048576).toFixed(2)+' MB'; }

  function mkItem(id, name, size, dir) {
    const el = document.createElement('div');
    el.className = 'transfer-item'; el.id = 'ti-'+id;
    el.innerHTML =
      `<div class="ti-top"><span class="ti-name">${esc(name)}</span>`+
      `<span class="ti-dir ${dir}">${dir==='out'?'↑ Sending':'↓ Receiving'}</span></div>`+
      `<div class="ti-sz">${fmt(size)}</div>`+
      `<div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>`+
      `<div class="ti-pct">0%</div>`;
    $list().prepend(el);
    return el;
  }
  function setPct(el, p) {
    el.querySelector('.progress-fill').style.width = Math.min(p,100)+'%';
    el.querySelector('.ti-pct').textContent = p>=100?'✓ Done':p+'%';
  }
  function addSave(el, name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url; a.download=name; a.className='ti-save'; a.textContent='↓ Save file';
    el.querySelector('.ti-dir').textContent='↓ Received';
    el.querySelector('.ti-pct').textContent='✓ Done';
    el.appendChild(a);
  }

  async function sendFile(file, toPeerId) {
    const label = Channels.LABELS.FILE;
    const mode  = _getMode ? _getMode() : 'p2p';

    // Check at least one channel is open
    if (!Channels.isOpen(label)) { UI.toast('No open file channel', 'error'); return; }

    const id    = Date.now().toString(36)+Math.random().toString(36).slice(2);
    const total = Math.ceil(file.size/CHUNK)||1;
    const el    = mkItem(id, file.name, file.size, 'out');

    const meta = { type:'file-meta', transferId:id, name:file.name, size:file.size, totalChunks:total, mime:file.type||'application/octet-stream' };

    if (mode==='group') {
      if (toPeerId) Channels.sendToJSON(toPeerId, label, meta);
      else Channels.broadcastJSON(label, meta);
    } else {
      Channels.sendJSON(label, meta);
    }

    let buf;
    try { buf = await file.arrayBuffer(); }
    catch(e) { UI.toast('Cannot read file', 'error'); return; }

    for (let i=0; i<total; i++) {
      // Recheck
      if (!Channels.isOpen(label)) { el.querySelector('.ti-pct').textContent='✗ Lost'; return; }

      const slice     = buf.slice(i*CHUNK,(i+1)*CHUNK);
      const hdrStr    = JSON.stringify({ type:'file-chunk', transferId:id, index:i });
      const hdrBytes  = new TextEncoder().encode(hdrStr);
      const out       = new Uint8Array(4+hdrBytes.length+slice.byteLength);
      new DataView(out.buffer).setUint32(0, hdrBytes.length);
      out.set(hdrBytes, 4);
      out.set(new Uint8Array(slice), 4+hdrBytes.length);

      let sent=false;
      for (let t=0;t<200&&!sent;t++) {
        if (mode==='group') {
          if (toPeerId) sent=Channels.sendTo(toPeerId,label,out.buffer);
          else { Channels.broadcast(label,out.buffer); sent=true; }
        } else {
          sent=Channels.send(label,out.buffer);
        }
        if (!sent) await new Promise(r=>setTimeout(r,10));
      }
      if (!sent) { el.querySelector('.ti-pct').textContent='✗ Buffer full'; return; }

      setPct(el, Math.round(((i+1)/total)*100));
      if (i%10===9) await new Promise(r=>setTimeout(r,0));
    }
  }

  function onData(data, fromPeerId) {
    if (data instanceof ArrayBuffer) {
      const dv    = new DataView(data);
      const mLen  = dv.getUint32(0);
      let meta;
      try { meta = JSON.parse(new TextDecoder().decode(new Uint8Array(data,4,mLen))); }
      catch { return; }
      const chunk = data.slice(4+mLen);
      const tx    = _in[meta.transferId];
      if (!tx) return;
      tx.chunks[meta.index]=chunk; tx.got++;
      setPct(tx.el, Math.round((tx.got/tx.total)*100));
      if (tx.got===tx.total) {
        addSave(tx.el, tx.name, new Blob(tx.chunks,{type:tx.mime}));
        UI.toast('Received: '+tx.name);
        delete _in[meta.transferId];
      }
      return;
    }
    let msg; try { msg=JSON.parse(data); } catch { return; }
    if (msg.type==='file-meta') {
      const el=mkItem(msg.transferId,msg.name,msg.size,'in');
      _in[msg.transferId]={ el, name:msg.name, mime:msg.mime, total:msg.totalChunks, got:0, chunks:[] };
      UI.toast('Incoming: '+msg.name+' ('+fmt(msg.size)+')');
    }
  }

  function initDrop() {
    const zone  = document.getElementById('drop-zone');
    const input = document.getElementById('file-input');
    if (!zone||!input) return;
    zone.addEventListener('dragenter', e=>e.preventDefault());
    zone.addEventListener('dragover',  e=>{ e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', e=>{ if(!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', e=>{ e.preventDefault(); zone.classList.remove('drag-over'); [...(e.dataTransfer.files||[])].forEach(f=>sendFile(f)); });
    zone.addEventListener('click', e=>{ if(e.target.tagName==='LABEL'||e.target.tagName==='INPUT'||e.target.closest('label')) return; input.click(); });
    input.addEventListener('change', ()=>{ [...(input.files||[])].forEach(f=>sendFile(f)); input.value=''; });
  }

  function init(getMode) {
    _getMode = getMode;
    Channels.onMessage(Channels.LABELS.FILE, onData);
    initDrop();
  }

  return { init, sendFile };
})();
