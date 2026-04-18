'use strict';
window.QRModule = (() => {
  let _libLoaded  = false;
  let _appUrl     = null;   // cached from /api/server-info

  // ── Load qrcodejs once ──────────────────────────────────────────────────
  function _loadLib() {
    return new Promise(resolve => {
      if (_libLoaded || window.QRCode) { _libLoaded = true; resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.onload  = () => { _libLoaded = true; resolve(); };
      s.onerror = ()  => resolve();   // graceful: fallback to text link
      document.head.appendChild(s);
    });
  }

  // ── Get the base app URL from server (public or LAN) ───────────────────
  async function _getAppUrl() {
    if (_appUrl) return _appUrl;
    try {
      const r = await fetch('/api/server-info');
      const d = await r.json();
      // Always prefer the value the SERVER computed — it knows if it's on Railway/Render/etc.
      _appUrl = (d.appUrl || location.origin).replace(/\/$/, '');
    } catch {
      _appUrl = location.origin;
    }
    return _appUrl;
  }

  // ── Render QR ────────────────────────────────────────────────────────────
  async function generate(roomId) {
    await _loadLib();
    const base = await _getAppUrl();
    const url  = `${base}?room=${encodeURIComponent(roomId)}`;

    // --- Completely wipe previous QR (qrcodejs keeps internal state) ---
    const wrap = document.getElementById('qr-canvas-wrap');
    wrap.innerHTML = '';
    delete wrap._oQRCode;

    if (window.QRCode) {
      const target = document.createElement('div');
      wrap.appendChild(target);

      new window.QRCode(target, {
        text:         url,
        width:        180,
        height:       180,
        colorDark:    '#1a2810',
        colorLight:   '#FBE8CE',
        correctLevel: window.QRCode.CorrectLevel.M,
      });

      // qrcodejs ALWAYS injects both <canvas> AND <img>.
      // Hide the img immediately + via observer for async injection.
      const hideImgs = () => target.querySelectorAll('img')
                                   .forEach(i => { i.style.display = 'none'; });
      hideImgs();
      const mo = new MutationObserver(hideImgs);
      mo.observe(target, { childList: true, subtree: true });
      setTimeout(() => { mo.disconnect(); hideImgs(); }, 800);
    } else {
      // Fallback: plain clickable link
      wrap.innerHTML = `<a href="${url}" style="font-size:.65rem;word-break:break-all;
        color:var(--t2);padding:.5rem;display:block" target="_blank">${url}</a>`;
    }

    // Show URL text + section
    const roomText = document.getElementById('room-id-text');
    if (roomText) roomText.textContent = url;
    const sec = document.getElementById('qr-section');
    if (sec) sec.classList.remove('hidden');

    const copyBtn = document.getElementById('btn-copy-room');
    if (copyBtn) {
      copyBtn.onclick = () =>
        navigator.clipboard.writeText(url)
          .then(() => UI.toast('Link copied!'))
          .catch(()  => UI.toast('Copy failed', 'error'));
    }

    return url;
  }

  function getRoomFromUrl() {
    return new URLSearchParams(location.search).get('room') || null;
  }

  return { generate, getRoomFromUrl };
})();
