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
  const modal = document.querySelector('#nameModal');
  const form = document.querySelector('#nameForm');
  const titleInput = document.querySelector('#nameInput');
  const heading = document.querySelector('#nameModalTitle');
  const hint = document.querySelector('#nameModalHint');
  const cancel = document.querySelector('#nameCancel');
  const cancelButton = document.querySelector('#nameCancelButton');
  const confirm = document.querySelector('#nameConfirm');
  let pendingType = 'chat';

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function openModal(type) {
    if (!modal || !titleInput) return;
    pendingType = type;
    const isProject = type === 'project';
    if (heading) heading.textContent = isProject ? 'Create a project' : 'Create a new chat';
    if (hint) hint.textContent = isProject
      ? 'Give your workspace a name so you can find it easily later.'
      : 'Give this conversation a name.';
    titleInput.value = isProject ? 'New project' : 'New chat';
    titleInput.select();
    modal.hidden = false;
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => titleInput.focus());
  }

  async function create() {
    const title = titleInput?.value.trim();
    if (!title) {
      titleInput?.focus();
      return;
    }

    if (confirm) confirm.disabled = true;
    try {
      await api('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: pendingType, title })
      });
      closeModal();
      await refresh();
    } catch (error) {
      if (hint) hint.textContent = error.message || 'Could not create it. Try again.';
    } finally {
      if (confirm) confirm.disabled = false;
    }
  }

  document.querySelector('#newChat')?.addEventListener('click', () => openModal('chat'));
  document.querySelector('#newProject')?.addEventListener('click', () => openModal('project'));
  cancel?.addEventListener('click', closeModal);
  cancelButton?.addEventListener('click', closeModal);
  form?.addEventListener('submit', event => {
    event.preventDefault();
    create();
  });
  modal?.addEventListener('click', event => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal && !modal.hidden) closeModal();
  });
}
