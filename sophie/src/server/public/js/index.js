'use strict';

import { initLogin } from './login.js';
import { renderArtifacts, initArtifacts } from './artifacts.js';
import { renderRecents, initRecents } from './recents.js';

const $ = selector => document.querySelector(selector);
const feed = $('#feed');
const input = $('#input');
const app = $('.app');
let activeThread = null;
let activeRequestId = null;
let commandRunning = false;
let activeOutput = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function formatAnswer(text) {
  let value = escapeHtml(text).replace(/\\r?\\n/g, '\n');
  value = value.replace(/^#{1,3}\s+(.+)$/gm, '<h3>$1</h3>');
  value = value.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  value = value.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  value = value.replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>');
  value = value.replace(/(?:<li>.*<\/li>\n?)+/g, match => '<ul>' + match.replace(/\n/g, '') + '</ul>');
  return value.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
}

function addActions(node, role, text) {
  const bar = document.createElement('div');
  bar.className = 'msg-actions';

  const add = (label, title, handler) => {
    const button = document.createElement('button');
    button.className = 'msg-action';
    button.textContent = label;
    button.title = title;
    button.addEventListener('click', handler);
    bar.appendChild(button);
  };

  add('Copy', 'Copy message', () => navigator.clipboard?.writeText(text));
  add('Select', 'Select text', () => {
    const range = document.createRange();
    range.selectNodeContents(node.querySelector('.body'));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });

  if (role === 'user') {
    add('Edit', 'Edit prompt', () => {
      input.value = text;
      input.focus();
    });
    add('Share', 'Share prompt', async () => {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard?.writeText(text);
    });
  } else {
    add('Regenerate', 'Regenerate response', () => {
      const previous = [...document.querySelectorAll('.msg.user')].pop();
      if (previous) {
        input.value = previous.querySelector('.body').textContent;
        send(true);
      }
    });
  }

  node.appendChild(bar);
}

function msg(role, text, options = {}) {
  $('#welcome')?.remove();
  const node = document.createElement('div');
  node.className = 'msg ' + role;
  node.innerHTML = '<div class="meta">' + (role === 'user' ? 'YOU' : 'SOPHIE') +
    '</div><div class="body"></div>';

  node.querySelector('.body').innerHTML =
    role === 'assistant' && options.plain !== true
      ? formatAnswer(text)
      : escapeHtml(text).replace(/\n/g, '<br>');

  feed.appendChild(node);
  if (text) addActions(node, role, text);
  feed.scrollTop = feed.scrollHeight;
  return node;
}

function pipeline(step) {
  document.querySelectorAll('.step').forEach((node, index) => {
    node.classList.toggle('on', index === step);
    node.classList.toggle('done', index < step);
  });
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: options.credentials || 'same-origin',
    cache: options.cache || 'no-store'
  });

  if (!response.ok) {
    throw new Error((await response.json().catch(() => ({}))).error ||
      `Request failed (${response.status})`);
  }
  return response.json();
}

async function load() {
  try {
    const [status, threads, artifacts, mode] = await Promise.all([
      api('/api/status'),
      api('/api/threads'),
      api('/api/artifacts'),
      api('/api/mode')
    ]);

    $('#version').textContent = status.version || '—';
    $('#memory').textContent = status.memoryFacts + ' facts';
    $('#modules').textContent = (status.modules || []).length;
    $('#mode').textContent = mode.label || mode.mode || 'GPT Mode';
    $('#mode2').textContent = mode.label || mode.mode || 'GPT Mode';
    activeThread = threads.activeThreadId;

    renderRecents(threads, { api, app, refresh: load });
    renderArtifacts(artifacts, $('#artifacts'));

    const toolsRoot = $('#toolsList');
    try {
      const tools = await api('/api/tools');
      toolsRoot.innerHTML = (tools.tools || []).map(tool =>
        '<div class="drawer-item"><span>' + escapeHtml(tool.name) +
        '</span><span class="tool-pill">' + escapeHtml(tool.risk || 'medium') +
        '</span></div>'
      ).join('') || '<div class="empty">No tools registered.</div>';
    } catch {
      toolsRoot.innerHTML = '<div class="empty">Tools unavailable.</div>';
    }
  } catch (error) {
    $('#statusText').textContent = 'Runtime unavailable';
  }
}

window.sophieLoadWorkspace = load;

async function send() {
  const text = input.value.trim();
  if (!text || commandRunning) return;

  input.value = '';
  commandRunning = true;
  activeRequestId = crypto.randomUUID();
  $('#send').classList.add('stop');
  $('#send').textContent = 'Stop';
  $('#commandState').textContent = 'Running…';

  msg('user', text);
  activeOutput = msg('assistant', 'Planning and executing…', { plain: true });
  pipeline(1);

  try {
    const result = await api('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: text, requestId: activeRequestId })
    });

    pipeline(8);
    const answer = result.text || result.response || JSON.stringify(result, null, 2);
    activeOutput.querySelector('.body').innerHTML = formatAnswer(answer);
    if (!activeOutput.querySelector('.msg-actions')) addActions(activeOutput, 'assistant', answer);
  } catch (error) {
    pipeline(error.message.includes('cancel') ? 1 : 5);
    activeOutput.querySelector('.body').innerHTML =
      formatAnswer(error.message.includes('cancel')
        ? 'Stopped by you.'
        : 'I could not complete that task: ' + error.message);
  } finally {
    commandRunning = false;
    activeRequestId = null;
    $('#send').classList.remove('stop');
    $('#send').textContent = 'Run ↗';
    $('#commandState').textContent = '';
    await load();
  }
}

async function stopCommand() {
  if (!activeRequestId) return;
  $('#commandState').textContent = 'Stopping…';
  try {
    await api('/api/command/' + encodeURIComponent(activeRequestId) + '/cancel', { method: 'POST' });
  } catch (error) {
    $('#commandState').textContent = 'Could not stop: ' + error.message;
  }
}

function bindInterface() {
  $('#send').addEventListener('click', async () => {
    if (commandRunning) return stopCommand();
    if (await ensureAccess()) send();
  });

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });

  document.querySelectorAll('.chip').forEach(button => {
    button.addEventListener('click', () => {
      input.value = button.textContent;
      input.focus();
    });
  });

  const menu = () => {
    app.classList.toggle('menu-open');
    app.classList.remove('inspector-open');
  };
  $('#mobileMenu').addEventListener('click', menu);
  $('#menuClose').addEventListener('click', () => app.classList.remove('menu-open'));
  $('#panelBtn').addEventListener('click', () => {
    app.classList.toggle('inspector-open');
    app.classList.remove('menu-open');
  });
  $('#intelligenceBtn').addEventListener('click', () => {
    app.classList.remove('menu-open');
    feed.scrollTop = feed.scrollHeight;
  });
  $('#diagBtn').addEventListener('click', async () => {
    app.classList.add('inspector-open');
    app.classList.remove('menu-open');
    try {
      msg('assistant', 'Diagnostics\n' + JSON.stringify(await api('/api/diagnostics'), null, 2));
    } catch (error) {
      msg('assistant', error.message);
    }
  });
}

const { ensureAccess } = initLogin({ api, loadWorkspace: load });
initRecents({ api, app, refresh: load });
initArtifacts({ app, root: $('#artifacts') });
bindInterface();

ensureAccess().then(authenticated => {
  if (authenticated) load();
}).catch(error => {
  $('#statusText').textContent = error.message || 'Authentication unavailable';
});
