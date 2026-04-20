'use strict';
window.QRModule = (() => {
  let _libLoaded = false;
  let _appUrl    = null;

  function _loadLib() {
    return new Promise(resolve => {
      if (_libLoaded||window.QRCode) { _libLoaded=true; resolve(); return; }
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.onload=()=>{ _libLoaded=true; resolve(); }; s.onerror=()=>resolve();
      document.head.appendChild(s);
    });
  }

  async function _getAppUrl() {
    if (_appUrl) return _appUrl;
    try { const r=await fetch('/api/server-info'); const d=await r.json(); _appUrl=(d.appUrl||location.origin).replace(/\/$/,''); }
    catch { _appUrl=location.origin; }
    return _appUrl;
  }

  async function generate(roomId, mode) {
    await _loadLib();
    const base = await _getAppUrl();
    // Include mode in URL so the joiner auto-inherits the room mode
    const url  = `${base}?room=${encodeURIComponent(roomId)}&mode=${mode||'p2p'}`;

    const wrap = document.getElementById('qr-canvas-wrap');
    wrap.innerHTML = ''; delete wrap._oQRCode;

    if (window.QRCode) {
      const target = document.createElement('div');
      wrap.appendChild(target);
      new window.QRCode(target, { text:url, width:180, height:180, colorDark:'#1a2810', colorLight:'#FBE8CE', correctLevel:window.QRCode.CorrectLevel.M });
      const hide=()=>target.querySelectorAll('img').forEach(i=>i.style.display='none');
      hide();
      const mo=new MutationObserver(hide); mo.observe(target,{childList:true,subtree:true});
      setTimeout(()=>{ mo.disconnect(); hide(); }, 800);
    } else {
      wrap.innerHTML=`<a href="${url}" style="font-size:.65rem;word-break:break-all;color:var(--t2);padding:.5rem;display:block">${url}</a>`;
    }

    const txt=document.getElementById('room-id-text'); if(txt) txt.textContent=url;
    const sec=document.getElementById('qr-section');   if(sec) sec.classList.remove('hidden');
    const btn=document.getElementById('btn-copy-room');
    if(btn) btn.onclick=()=>navigator.clipboard.writeText(url).then(()=>UI.toast('Link copied!')).catch(()=>UI.toast('Copy failed','error'));
    return url;
  }

  function getRoomFromUrl() { return new URLSearchParams(location.search).get('room')||null; }

  return { generate, getRoomFromUrl };
})();
