window.UI = (() => {
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  function _switch(name) {
    document.querySelectorAll('.tab,.snav').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    const p = document.getElementById('tab-' + name);
    if (p) p.classList.remove('hidden');
  }

  function initTabs() {
    document.querySelectorAll('.tab,.snav').forEach(b => b.addEventListener('click', () => _switch(b.dataset.tab)));
    const mob = document.getElementById('btn-disconnect-mob');
    const dsk = document.getElementById('btn-disconnect');
    if (mob && dsk) mob.addEventListener('click', () => dsk.click());
  }

  function toast(msg, type, dur) {
    const c = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type === 'error' ? 'error' : 'success');
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => { el.style.transition='opacity .25s'; el.style.opacity='0'; setTimeout(()=>el.remove(),260); }, dur||3000);
  }

  function setMode(label, color) {
    const el = document.getElementById('mode-badge');
    if (el) el.innerHTML = '<span class="dot dot-'+(color||'green')+'"></span> '+label;
  }

  function setPeerStatus(text) {
    const el = document.getElementById('peer-status');
    if (el) el.textContent = text;
  }

  return { showScreen, initTabs, toast, setMode, setPeerStatus };
})();
