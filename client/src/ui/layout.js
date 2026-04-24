'use strict';
window.UI = (() => {

  /* ── Theme ─────────────────────────────────────────────────────────────── */
  let _theme = localStorage.getItem('ss-theme') || 'dark';

  function _applyTheme(t) {
    _theme = t;
    document.documentElement.dataset.theme = t === 'light' ? 'light' : '';
    localStorage.setItem('ss-theme', t);
    const moon = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    const sun  = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    document.querySelectorAll('[id^="theme-icon"]').forEach(el => { el.innerHTML = t === 'light' ? moon : sun; });
    document.querySelectorAll('[id^="theme-label"]').forEach(el => { el.textContent = t === 'light' ? 'Dark' : 'Light'; });
  }
  _applyTheme(_theme);

  /* ── Scroll-reveal IntersectionObserver ────────────────────────────────── */
  function _initReveal() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.lp-reveal').forEach(el => io.observe(el));
  }

  /* ── Screen switching ───────────────────────────────────────────────────── */
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('active');
      // Scroll to top when switching screens
      el.scrollTo ? el.scrollTo(0,0) : window.scrollTo(0,0);
    }
    // Re-observe reveals when landing is shown
    if (id === 'landing-screen') setTimeout(_initReveal, 50);
  }

  function showModeSelect() {
    document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
    document.getElementById('create-section')?.classList.add('hidden');
    document.getElementById('qr-section')?.classList.add('hidden');
  }

  function showJoinPanel() {
    document.getElementById('join-panel')?.classList.remove('hidden');
  }

  /* ── Tabs ───────────────────────────────────────────────────────────────── */
  function _switchTab(name) {
    document.querySelectorAll('.tab,.snav').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById('tab-' + name)?.classList.remove('hidden');
  }

  /* ── Wire all buttons ───────────────────────────────────────────────────── */
  function initTabs() {
    /* Tab navigation */
    document.querySelectorAll('.tab,.snav').forEach(b => b.addEventListener('click', () => _switchTab(b.dataset.tab)));

    /* Theme toggles — all instances */
    document.querySelectorAll('[id^="theme-toggle"]').forEach(btn => {
      btn.addEventListener('click', () => _applyTheme(_theme === 'dark' ? 'light' : 'dark'));
    });

    /* Landing → App (open app) */
    ['lp-open-app'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => showScreen('connect-screen'));
    });

    /* Landing → Connect (start / create) */
    ['lp-start', 'lp-start-2', 'lp-start-3'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => showScreen('connect-screen'));
    });

    /* Landing → Connect (join — focus input) */
    ['lp-join-link', 'lp-join-link-2'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => {
        showScreen('connect-screen');
        setTimeout(() => document.getElementById('room-input')?.focus(), 120);
      });
    });

    /* Connect → Landing (back) */
    document.getElementById('btn-back-landing')?.addEventListener('click', () => showScreen('landing-screen'));

    /* Scroll-reveal on landing */
    _initReveal();
  }

  /* ── Toasts ─────────────────────────────────────────────────────────────── */
  function toast(msg, type, dur) {
    const c  = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type === 'error' ? 'error' : 'success');
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity    = '0';
      el.style.transform  = 'translateY(-6px)';
      setTimeout(() => el.remove(), 260);
    }, dur || 3200);
  }

  /* ── Status helpers ─────────────────────────────────────────────────────── */
  function setMode(label, color) {
    const el = document.getElementById('mode-badge');
    if (el) el.innerHTML = '<span class="dot dot-' + (color || 'green') + '"></span> ' + label;
  }

  function setPeerStatus(text) {
    const el = document.getElementById('peer-status');
    if (el) el.textContent = text;
  }

  function updatePeerList(peerNames) {
    const el = document.getElementById('peers-list');
    if (!el) return;
    const names = Object.values(peerNames);
    if (names.length === 0) {
      el.innerHTML = '<span class="peer-empty">No other members yet</span>';
    } else {
      el.innerHTML = names.map(n =>
        `<div class="peer-pill"><span class="dot dot-green"></span>${n}</div>`
      ).join('');
    }
  }

  function updateConnCount(n) {
    const txt = n === 1 ? '1 peer' : `${n} peers`;
    document.getElementById('conn-count')?.      setAttribute('textContent', txt) ||
    (document.getElementById('conn-count') && (document.getElementById('conn-count').textContent = txt));
    const mob = document.getElementById('conn-count-mob');
    if (mob) mob.textContent = n > 0 ? txt : '';
    // Also update sidebar count via textContent directly
    const sc = document.getElementById('conn-count');
    if (sc) sc.textContent = txt;
  }

  return {
    showScreen, showModeSelect, showJoinPanel,
    initTabs, toast,
    setMode, setPeerStatus, updatePeerList, updateConnCount,
  };
})();
