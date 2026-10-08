'use strict';

import { initLogin } from './login.js';
import { renderArtifacts, initArtifacts } from './artifacts.js';
import { renderRecents, initRecents } from './recents.js';
import { initControls } from './controls.js';
import { initAdmin } from './admin.js';
import { initVideo } from './video.js';

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

const PRE_STYLE = 'background:#080c12;border:1px solid #273448;border-radius:10px;padding:10px;overflow:auto;' +
  'white-space:pre;font-size:12px;line-height:1.45;margin:8px 0;max-width:100%';

function formatAnswer(text) {
  const blocks = [];
  const withoutCode = String(text ?? '').replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push('<pre style="' + PRE_STYLE + '"><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>');
    return '\u0000' + (blocks.length - 1) + '\u0000';
  });

  let value = escapeHtml(withoutCode).replace(/\\r?\\n/g, '\n');
  value = value.replace(/^#{1,3}\s+(.+)$/gm, '<h3>$1</h3>');
  value = value.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  value = value.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  value = value.replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>');
  value = value.replace(/(?:<li>.*<\/li>\n?)+/g, match => '<ul>' + match.replace(/\n/g, '') + '</ul>');
  value = value.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
  return value.replace(/\u0000(\d+)\u0000/g, (_, index) => blocks[Number(index)] || '');
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
const TEXT_RE = /\.(txt|md|csv|json|log)$/i;
const FRAME_STYLE = 'width:100%;height:440px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:#fff';

function artifactUrl(kind, artifactPath) {
  return '/api/artifacts/' + kind + '?path=' + encodeURIComponent(artifactPath);
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function renderInlineArtifacts(node, list) {
  const items = (Array.isArray(list) ? list : []).filter(item => item && item.path).slice(0, 6);
  if (!items.length || !node) return;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:12px;display:grid;gap:10px';

  for (const item of items) {
    const name = item.path.split('/').pop();
    const viewUrl = artifactUrl('view', item.path);
    const card = document.createElement('div');
    card.style.cssText = 'display:grid;gap:6px';

    if (IMAGE_RE.test(name)) {
      const link = document.createElement('a');
      link.href = viewUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      const image = document.createElement('img');
      image.src = viewUrl;
      image.alt = name;
      image.loading = 'lazy';
      image.style.cssText = 'max-width:100%;border-radius:12px;border:1px solid rgba(255,255,255,.14)';
      link.appendChild(image);
      card.appendChild(link);
    } else if (/\.pdf$/i.test(name)) {
      const frame = document.createElement('iframe');
      frame.src = viewUrl;
      frame.title = name;
      frame.style.cssText = FRAME_STYLE;
      card.appendChild(frame);
    } else if (/\.html?$/i.test(name)) {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
      frame.src = viewUrl;
      frame.title = name;
      frame.style.cssText = FRAME_STYLE;
      card.appendChild(frame);
    } else if (TEXT_RE.test(name)) {
      const pre = document.createElement('pre');
      pre.style.cssText = PRE_STYLE;
      pre.textContent = 'Loading preview…';
      card.appendChild(pre);
      fetch(viewUrl, { credentials: 'same-origin' })
        .then(response => (response.ok ? response.text() : Promise.reject(new Error('Preview unavailable'))))
        .then(body => { pre.textContent = body.length > 2500 ? body.slice(0, 2500) + '\n…' : body; })
        .catch(() => { pre.remove(); });
    }

    const footer = document.createElement('a');
    footer.href = artifactUrl('download', item.path);
    footer.target = '_blank';
    footer.rel = 'noopener';
    footer.textContent = '⬇ ' + name + (item.size ? ' · ' + formatSize(item.size) : '');
    footer.style.cssText = 'font-size:12px;opacity:.85';
    card.appendChild(footer);
    wrap.appendChild(card);
  }

  node.querySelector('.body').appendChild(wrap);
}

function addActions(node, role, text) {
  const bar = document.createElement('div');
  bar.className = 'msg-actions';

  const icons = {
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
    select: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3H4a1 1 0 0 0-1 1v3M17 3h3a1 1 0 0 1 1 1v3M21 17v3a1 1 0 0 1-1 1h-3M3 17v3a1 1 0 0 0 1 1h3"></path><path d="M8 8h8v8H8z"></path></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.5-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.5 16 4 20Z"></path><path d="m14.5 6.5 3 3"></path></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"></circle><circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="19" r="2.5"></circle><path d="m8.2 10.8 7.5-4.3M8.2 13.2l7.5 4.3"></path></svg>',
    regenerate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.7-4L3 10"></path><path d="M3 5v5h5"></path><path d="M4 13a8 8 0 0 0 14.7 4L21 14"></path><path d="M21 19v-5h-5"></path></svg>'
  };

  const add = (icon, title, handler) => {
    const button = document.createElement('button');
    button.className = 'msg-action';
    button.type = 'button';
    button.innerHTML = icons[icon];
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', handler);
    bar.appendChild(button);
  };

  add('copy', 'Copy message', async () => {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
  });

  if (role === 'user') {
    add('select', 'Select text', () => {
      const range = document.createRange();
      range.selectNodeContents(node.querySelector('.body'));
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    add('edit', 'Edit prompt', () => {
      input.value = text;
      input.focus();
    });
  } else {
    add('share', 'Share response', async () => {
      if (navigator.share) await navigator.share({ text });
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    });
    add('regenerate', 'Regenerate response', () => {
      const previous = [...document.querySelectorAll('.msg.user')].pop();
      if (previous) {
        input.value = previous.querySelector('.body').textContent;
        send();
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
      const plugins = await api('/api/plugins').catch(() => ({ plugins: [] }));
      const rows = (tools.tools || []).map(tool =>
        '<div class="drawer-item"><span>' + escapeHtml(tool.name) +
        '</span><span class="tool-pill">' + escapeHtml(tool.risk || 'medium') +
        '</span></div>'
      ).concat((plugins.plugins || []).map(plugin =>
        '<div class="drawer-item"><span>🧩 ' + escapeHtml(plugin.name) +
        '</span><span class="tool-pill">' + escapeHtml(plugin.risk || 'high') +
        '</span></div>'
      ));
      toolsRoot.innerHTML = rows.join('') || '<div class="empty">No tools registered.</div>';
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
    renderInlineArtifacts(activeOutput, result.artifacts);
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
const setCommandState = text => { $('#commandState').textContent = text || ''; };
initControls({
  api,
  app,
  ensureAccess,
  loadWorkspace: load,
  onMessage: msg,
  setState: setCommandState
});
initAdmin({ api, ensureAccess, setState: setCommandState });
initVideo({ api, ensureAccess, onMessage: msg, setState: setCommandState, loadWorkspace: load });
bindInterface();

ensureAccess().then(authenticated => {
  if (authenticated) load();
}).catch(error => {
  $('#statusText').textContent = error.message || 'Authentication unavailable';
});
