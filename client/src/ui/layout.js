'use strict';
window.UI = (() => {

  /* ── Theme ── */
  let _theme = localStorage.getItem('ss-theme') || 'dark';

  function _applyTheme(t) {
    _theme = t;
    document.documentElement.dataset.theme = t === 'light' ? 'light' : '';
    localStorage.setItem('ss-theme', t);
    const icons  = ['theme-icon'];
    const labels = ['theme-label'];
    const moonPath = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    const sunPath  = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    document.querySelectorAll('[id^="theme-icon"]').forEach(el => { el.innerHTML = t==='light' ? moonPath : sunPath; });
    document.querySelectorAll('[id^="theme-label"]').forEach(el => { el.textContent = t==='light' ? 'Dark' : 'Light'; });
  }
  _applyTheme(_theme);

  /* ── Screen switching ── */
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
  }

  function showModeSelect() {
    document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
    document.getElementById('create-section')?.classList.add('hidden');
    document.getElementById('qr-section')?.classList.add('hidden');
  }

  function showJoinPanel() {
    document.getElementById('join-panel')?.classList.remove('hidden');
  }

  /* ── Tabs ── */
  function _switch(name) {
    document.querySelectorAll('.tab,.snav').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById('tab-' + name)?.classList.remove('hidden');
  }

  function initTabs() {
    document.querySelectorAll('.tab,.snav').forEach(b => b.addEventListener('click', () => _switch(b.dataset.tab)));

    /* Theme toggles (both landing and connect have one) */
    document.querySelectorAll('[id^="theme-toggle"]').forEach(btn => {
      btn.addEventListener('click', () => _applyTheme(_theme === 'dark' ? 'light' : 'dark'));
    });

    /* Landing page navigation */
    const openApp = id => {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', () => showScreen('connect-screen'));
    };
    openApp('lp-open-app');
    openApp('lp-start');
    openApp('lp-start-2');
    document.getElementById('lp-join-link')?.addEventListener('click', () => {
      showScreen('connect-screen');
      // Focus the room input
      setTimeout(() => document.getElementById('room-input')?.focus(), 100);
    });
    document.getElementById('btn-back-landing')?.addEventListener('click', () => {
      showScreen('landing-screen');
    });
  }

  /* ── Toasts ── */
  function toast(msg, type, dur) {
    const c  = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type === 'error' ? 'error' : 'success');
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s';
      el.style.opacity    = '0';
      setTimeout(() => el.remove(), 260);
    }, dur || 3200);
  }

  /* ── Misc ── */
  function setMode(label, color) {
    const el = document.getElementById('mode-badge');
    if (el) el.innerHTML = '<span class="dot dot-' + (color||'green') + '"></span> ' + label;
  }

  function setPeerStatus(text) {
    const el = document.getElementById('peer-status');
    if (el) el.textContent = text;
  }

  function updatePeerList(peerNames) {
    const el = document.getElementById('peers-list');
    if (!el) return;
    const names = Object.values(peerNames);
    el.innerHTML = names.length === 0
      ? '<span class="peer-empty">No other members yet</span>'
      : names.map(n => `<div class="peer-pill"><span class="dot dot-green"></span>${n}</div>`).join('');
  }

  function updateConnCount(n) {
    const txt = n === 1 ? '1 peer' : `${n} peers`;
    const el  = document.getElementById('conn-count');
    const elm = document.getElementById('conn-count-mob');
    if (el)  el.textContent  = txt;
    if (elm) elm.textContent = n > 0 ? txt : '';
  }

  return { showScreen, showModeSelect, showJoinPanel, initTabs, toast, setMode, setPeerStatus, updatePeerList, updateConnCount };
})();
