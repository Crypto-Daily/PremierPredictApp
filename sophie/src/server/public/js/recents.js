'use strict';

function safe(value) {
  return String(value ?? '').replace(/[<>&]/g, '');
}

export function renderRecents(data, { api, app, refresh }) {
  const activeThread = data?.activeThreadId || null;

  function render(listId, type) {
    const root = document.querySelector('#' + listId);
    if (!root) return;

    const items = (data?.threads || []).filter(item => item.type === type);
    root.innerHTML = '';

    items.slice(0, 12).forEach(item => {
      const button = document.createElement('button');
      button.className = 'drawer-item ' + (item.id === activeThread ? 'active' : '');
      button.innerHTML = '<span>' + safe(item.title || 'Untitled') + '</span><small>›</small>';
      button.addEventListener('click', async () => {
        await api('/api/threads/' + encodeURIComponent(item.id) + '/activate', { method: 'POST' });
        app.classList.remove('menu-open');
        await refresh();
      });
      root.appendChild(button);
    });

    if (!items.length) root.innerHTML = '<div class="empty">None yet.</div>';
  }

  render('chatThreads', 'chat');
  render('projectThreads', 'project');
}

export function initRecents({ api, app, refresh }) {
  document.querySelector('#newChat')?.addEventListener('click', async () => {
    const title = prompt('Chat name', 'New chat');
    if (!title) return;
    await api('/api/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'chat', title })
    });
    await refresh();
  });

  document.querySelector('#newProject')?.addEventListener('click', async () => {
    const title = prompt('Project name', 'New project');
    if (!title) return;
    await api('/api/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'project', title })
    });
    await refresh();
  });
}
