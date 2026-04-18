// src/modules/clipboard.js — Clipboard sync module

window.ClipboardModule = (() => {

  function getHistory() { return document.getElementById('clipboard-history'); }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function addClipItem(text, direction, time) {
    const t = time ? new Date(time) : new Date();
    const timeStr = t.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    const dir = direction === 'in' ? 'in' : 'out';
    const label = direction === 'in' ? '↓ Received' : '↑ Sent';

    const el = document.createElement('div');
    el.className = `clip-item clip-${dir}`;
    el.innerHTML = `
      <div class="clip-text">${escapeHtml(text)}</div>
      <div class="clip-side">
        <span class="clip-meta">${label} · ${timeStr}</span>
        <button class="btn-clip-copy" onclick="ClipboardModule.copyText(this, ${JSON.stringify(text).replace(/</g,'\\u003c')})">Copy</button>
      </div>
    `;
    getHistory().prepend(el);
  }

  function send(text) {
    if (!text) return;
    if (!Channels.isOpen(Channels.LABELS.CLIPBOARD)) {
      UI.toast('Not connected yet', 'error'); return;
    }
    Channels.sendJSON(Channels.LABELS.CLIPBOARD, { type: 'clip', text, time: Date.now() });
    addClipItem(text, 'out');
    UI.toast('Clipboard sent');
  }

  async function readAndSend() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) { UI.toast('Clipboard is empty'); return; }
      send(text);
    } catch {
      UI.toast('Clipboard access denied — use the text box below', 'error');
    }
  }

  // Called from inline onclick — safe because text is JSON-encoded
  async function copyText(btn, text) {
    try {
      await navigator.clipboard.writeText(text);
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    } catch {
      UI.toast('Copy failed', 'error');
    }
  }

  function init() {
    Channels.onMessage(Channels.LABELS.CLIPBOARD, (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'clip') {
        addClipItem(msg.text, 'in', msg.time);
        if (document.hasFocus()) navigator.clipboard.writeText(msg.text).catch(() => {});
        UI.toast('Clipboard received');
      }
    });

    document.getElementById('btn-send-clip').addEventListener('click', readAndSend);

    document.getElementById('btn-read-clip').addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        document.getElementById('clip-input').value = text;
      } catch { UI.toast('Clipboard access denied', 'error'); }
    });

    document.getElementById('btn-send-clip-text').addEventListener('click', () => {
      const text = document.getElementById('clip-input').value.trim();
      if (text) { send(text); document.getElementById('clip-input').value = ''; }
    });
  }

  return { init, send, copyText };
})();
