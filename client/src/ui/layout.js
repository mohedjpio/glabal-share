'use strict';
window.UI = (() => {

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  function showModeSelect() {
    // Reset to step 1 (mode selection), hide create section
    document.querySelectorAll('.mode-card').forEach(c=>c.classList.remove('selected'));
    const cs = document.getElementById('create-section');
    if (cs) cs.classList.add('hidden');
    const qs = document.getElementById('qr-section');
    if (qs) qs.classList.add('hidden');
  }

  function showJoinPanel() {
    // When auto-joining from URL, show the join section
    const jp = document.getElementById('join-panel');
    if (jp) jp.classList.remove('hidden');
  }

  function _switch(name) {
    document.querySelectorAll('.tab,.snav').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.add('hidden'));
    const p = document.getElementById('tab-'+name);
    if (p) p.classList.remove('hidden');
  }

  function initTabs() {
    document.querySelectorAll('.tab,.snav').forEach(b=>b.addEventListener('click',()=>_switch(b.dataset.tab)));
  }

  function toast(msg, type, dur) {
    const c=document.getElementById('toast-container');
    const el=document.createElement('div');
    el.className='toast toast-'+(type==='error'?'error':'success');
    el.textContent=msg; c.appendChild(el);
    setTimeout(()=>{ el.style.transition='opacity .25s'; el.style.opacity='0'; setTimeout(()=>el.remove(),260); }, dur||3200);
  }

  function setMode(label, color) {
    const el=document.getElementById('mode-badge');
    if (el) el.innerHTML='<span class="dot dot-'+(color||'green')+'"></span> '+label;
  }

  function setPeerStatus(text) {
    const el=document.getElementById('peer-status');
    if (el) el.textContent=text;
  }

  // Update the peers list panel (group mode sidebar widget)
  function updatePeerList(peerNames) {
    const el=document.getElementById('peers-list');
    if (!el) return;
    const names = Object.values(peerNames);
    el.innerHTML = names.length===0
      ? '<span class="peer-empty">No other members yet</span>'
      : names.map(n=>`<div class="peer-pill"><span class="dot dot-green"></span>${n}</div>`).join('');
  }

  function updateConnCount(n) {
    const el=document.getElementById('conn-count');
    if (el) el.textContent = n===1?'1 peer':`${n} peers`;
  }

  return { showScreen, showModeSelect, showJoinPanel, initTabs, toast, setMode, setPeerStatus, updatePeerList, updateConnCount };
})();
