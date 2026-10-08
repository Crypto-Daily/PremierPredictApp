'use strict';

function el(tag, styles, text) {
  const node = document.createElement(tag);
  if (styles) node.style.cssText = styles;
  if (text) node.textContent = text;
  return node;
}

export function initAdmin({ api, ensureAccess, setState }) {
  const anchor = document.querySelector('#screen') || document.querySelector('#attach');
  const button = el('button');
  button.type = 'button';
  button.id = 'adminBtn';
  button.className = anchor ? anchor.className : '';
  button.title = 'Unlock server commands and plugin changes for 30 minutes';

  if (anchor) anchor.insertAdjacentElement('afterend', button);
  else document.body.appendChild(button);

  let unlocked = false;

  function paint() {
    button.textContent = unlocked ? '🔓 Admin on' : '🔒 Admin';
  }

  async function refresh() {
    try {
      const session = await api('/api/self-upgrade/session');
      unlocked = Boolean(session.authorized);
    } catch {
      unlocked = false;
    }
    paint();
  }

  function dialog() {
    const overlay = el('div', 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px');
    const box = el('div', 'background:#101620;color:#e8eef7;border:1px solid #2a3647;border-radius:14px;padding:18px;width:100%;max-width:340px;font:14px system-ui,sans-serif');
    const title = el('div', 'font-weight:600;margin-bottom:6px', 'Unlock Admin (30 minutes)');
    const hint = el('div', 'opacity:.7;margin-bottom:12px;font-size:12px', 'Allows running server commands and approving plugins. Enter the passcode here, never in chat.');
    const input = el('input', 'width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #2a3647;background:#0a0f16;color:#e8eef7;font-size:16px');
    input.type = 'password';
    input.autocomplete = 'off';
    input.placeholder = 'Admin passcode';
    const error = el('div', 'color:#ff8a8a;font-size:12px;min-height:16px;margin-top:6px');
    const row = el('div', 'display:flex;gap:8px;margin-top:10px');
    const cancel = el('button', 'flex:1;padding:10px;border-radius:8px;border:1px solid #2a3647;background:transparent;color:#e8eef7', 'Cancel');
    const submit = el('button', 'flex:1;padding:10px;border-radius:8px;border:0;background:#c9a24b;color:#111;font-weight:600', 'Unlock');
    cancel.type = submit.type = 'button';
    row.append(cancel, submit);
    box.append(title, hint, input, error, row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    input.focus();

    const close = () => overlay.remove();
    cancel.addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });

    async function attempt() {
      if (!input.value) return;
      submit.disabled = true;
      error.textContent = '';
      try {
        await api('/api/self-upgrade/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode: input.value })
        });
        input.value = '';
        close();
        unlocked = true;
        paint();
        setState('Admin unlocked for 30 minutes.');
      } catch (failure) {
        error.textContent = failure.message || 'Could not unlock.';
        submit.disabled = false;
        input.select();
      }
    }

    submit.addEventListener('click', attempt);
    input.addEventListener('keydown', event => { if (event.key === 'Enter') attempt(); });
  }

  button.addEventListener('click', async () => {
    if (!(await ensureAccess())) return;
    if (unlocked) {
      try { await api('/api/self-upgrade/session', { method: 'DELETE' }); } catch { /* ignore */ }
      unlocked = false;
      paint();
      setState('Admin locked.');
      return;
    }
    dialog();
  });

  paint();
  refresh();
  setInterval(refresh, 60000);
}
