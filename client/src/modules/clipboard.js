'use strict';
window.ClipboardModule = (() => {

  function $hist() { return document.getElementById('clipboard-history'); }
  function esc(s)  { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Store items in a WeakMap keyed by element, value is the raw text
  const _itemText = new Map(); // element → text

  function addItem(text, dir, time) {
    const t  = time ? new Date(time) : new Date();
    const ts = t.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    const lbl = dir==='in' ? '↓ Received' : '↑ Sent';

    const el  = document.createElement('div');
    el.className = `clip-item ci-${dir}`;

    // Store text on the element directly — no inline onclick with encoded data
    el.dataset.clipText = text;

    el.innerHTML =
      `<div class="ci-txt">${esc(text)}</div>`+
      `<div class="ci-side">`+
        `<span class="ci-meta">${lbl} · ${ts}</span>`+
        `<button class="btn-cpcopy" data-action="copy">Copy</button>`+
      `</div>`;

    // Wire copy button via event listener — safe, no attribute encoding needed
    el.querySelector('[data-action="copy"]').addEventListener('click', function() {
      const rawText = el.dataset.clipText;
      navigator.clipboard.writeText(rawText)
        .then(() => {
          this.textContent = 'Copied!';
          setTimeout(() => { this.textContent = 'Copy'; }, 1500);
        })
        .catch(() => {
          // Fallback for HTTP contexts
          try {
            const ta = document.createElement('textarea');
            ta.value = rawText;
            ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            this.textContent = 'Copied!';
            setTimeout(() => { this.textContent = 'Copy'; }, 1500);
          } catch { UI.toast('Copy failed', 'error'); }
        });
    });

    $hist().prepend(el);
  }

  function send(text) {
    if (!text) return;
    if (!Channels.isOpen(Channels.LABELS.CLIPBOARD)) {
      UI.toast('Not connected yet', 'error'); return;
    }
    const payload = { type:'clip', text, time:Date.now() };
    const sent = Channels.broadcastJSON(Channels.LABELS.CLIPBOARD, payload) ||
                 Channels.sendJSON(Channels.LABELS.CLIPBOARD, payload);
    if (sent) { addItem(text, 'out'); UI.toast('Clipboard sent'); }
  }

  async function readAndSend() {
    if (!navigator.clipboard?.readText) {
      UI.toast('Clipboard API unavailable on HTTP — use the text box', 'error'); return;
    }
    try {
      const t = await navigator.clipboard.readText();
      if (!t) { UI.toast('Clipboard is empty'); return; }
      send(t);
    } catch(e) {
      if (e.name === 'NotAllowedError') {
        UI.toast('Allow clipboard access in browser settings', 'error');
      } else {
        UI.toast('Cannot read clipboard — use the text box', 'error');
      }
    }
  }

  function init() {
    Channels.onMessage(Channels.LABELS.CLIPBOARD, (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'clip') {
        addItem(msg.text, 'in', msg.time);
        if (document.hasFocus() && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(msg.text).catch(()=>{});
        }
        UI.toast('Clipboard received');
      }
    });

    document.getElementById('btn-send-clip').addEventListener('click', readAndSend);

    document.getElementById('btn-read-clip').addEventListener('click', async () => {
      if (!navigator.clipboard?.readText) {
        UI.toast('Clipboard API unavailable on HTTP', 'error'); return;
      }
      try {
        document.getElementById('clip-input').value = await navigator.clipboard.readText();
      } catch { UI.toast('Clipboard access denied', 'error'); }
    });

    document.getElementById('btn-send-clip-text').addEventListener('click', () => {
      const t = document.getElementById('clip-input').value.trim();
      if (t) { send(t); document.getElementById('clip-input').value=''; }
    });
  }

  return { init, send };
})();
