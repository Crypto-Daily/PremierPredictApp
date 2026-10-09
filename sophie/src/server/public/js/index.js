'use strict';

import { initLogin } from './login.js';
import { renderArtifacts, initArtifacts } from './artifacts.js';
import { renderRecents, initRecents } from './recents.js';
import { api } from './api.js';
import { initControls } from './controls.js';
import { setState, getState, subscribe } from './state.js';

const $ = selector => document.querySelector(selector);
const feed = $('#feed');
const input = $('#input');
const app = $('.app');

let activeOutput = null;
let statusPoll = null;
let executionStartedAt = 0;
let executionClock = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function formatAnswer(text) {
  let value = escapeHtml(text).replace(/\r?\n/g, '\n');
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

  const add = (icon, title, handler) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'msg-action';
    button.textContent = icon;
    button.setAttribute('aria-label', title);
    button.title = title;
    button.addEventListener('click', async () => {
      try { await handler(); } catch (error) { setStatus(error.message || 'Action failed.'); }
    });
    bar.appendChild(button);
  };

  add('⧉', 'Copy message', async () => {
    if (!navigator.clipboard) throw new Error('Clipboard access is unavailable.');
    await navigator.clipboard.writeText(text);
    setStatus('Copied.');
  });

  add('☷', 'Select message text', () => {
    const body = node.querySelector('.body');
    const range = document.createRange();
    range.selectNodeContents(body);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });

  if (role === 'user') {
    add('✎', 'Edit prompt', () => {
      input.value = text;
      input.focus();
      input.dispatchEvent(new Event('input'));
    });

    add('↗', 'Share prompt', async () => {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setStatus('Copied for sharing.');
      }
    });
  } else {
    add('↻', 'Regenerate response', async () => {
      const previous = [...document.querySelectorAll('.msg.user')].pop();
      if (!previous || getState().command.running) return;
      input.value = previous.querySelector('.body').textContent;
      await send();
    });
  }

  node.appendChild(bar);
}

function msg(role, text, options = {}) {
  $('#welcome')?.remove();

  const node = document.createElement('div');
  node.className = 'msg ' + role;
  node.innerHTML = '<div class="meta">' +
    (role === 'user' ? 'YOU' : 'SOPHIE') +
    '</div><div class="body"></div>';

  if (role === 'user' && Array.isArray(options.attachments) && options.attachments.length) {
    const attachments = document.createElement('div');
    attachments.className = 'message-attachments';
    options.attachments.forEach(file => {
      const card = document.createElement('div');
      card.className = 'message-attachment';
      if (file.previewUrl && String(file.mimeType || '').startsWith('image/')) {
        const image = document.createElement('img');
        image.src = file.previewUrl;
        image.alt = file.name || 'Attached image';
        card.appendChild(image);
      } else {
        const icon = document.createElement('span');
        icon.className = 'message-file-icon';
        icon.textContent = '↳';
        card.appendChild(icon);
      }
      const label = document.createElement('span');
      label.textContent = file.name || 'Attachment';
      card.appendChild(label);
      attachments.appendChild(card);
    });
    node.appendChild(attachments);
  }

  const body = node.querySelector('.body');
  body.innerHTML = role === 'assistant' && options.plain !== true
    ? formatAnswer(text)
    : escapeHtml(text).replace(/\n/g, '<br>');

  feed.appendChild(node);
  if (text) addActions(node, role, text);
  feed.scrollTop = feed.scrollHeight;
  return node;
}

function renderHistory(thread) {
  feed.innerHTML = '';

  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  if (!messages.length) {
    feed.innerHTML = `
      <div class="welcome" id="welcome">
        <div class="eyebrow">NEXUS-OMEGA ONLINE</div>
        <h1>What should Sophie do?</h1>
        <p>Give me a task, ask a question, upload a file, or switch to Jarvis Mode when you need interactive execution.</p>
        <div class="chips">
          <button class="chip" type="button" data-prompt="Analyze a document">Analyze a document</button>
          <button class="chip" type="button" data-prompt="Research a topic">Research a topic</button>
          <button class="chip" type="button" data-prompt="Build something">Build something</button>
          <button class="chip" type="button" data-prompt="Inspect my workspace">Inspect my workspace</button>
        </div>
      </div>`;
    document.querySelectorAll('.chip').forEach(button => {
      button.addEventListener('click', () => {
        input.value = button.dataset.prompt || button.textContent.trim();
        input.focus();
      });
    });
    return;
  }

  messages.forEach(message => {
    if (message?.role === 'user' || message?.role === 'assistant') {
      msg(message.role, message.text || '');
    }
  });
}

function updateLive(activity = 'Working…', step = 0, state = 'running') {
  const strip = $('#executionStrip');
  const label = $('#executionLabel');
  const liveTitle = $('#liveTitle');
  const liveDetail = $('#liveDetail');
  const progress = $('#liveProgress');
  const card = $('#liveCard');
  if (!strip || !label || !liveTitle || !liveDetail || !progress || !card) return;
  strip.hidden = state !== 'running';
  label.textContent = state === 'running' ? activity : (state === 'complete' ? 'Completed' : 'Stopped');
  liveTitle.textContent = state === 'running' ? 'Sophie is working' : (state === 'complete' ? 'Task complete' : 'Task stopped');
  liveDetail.textContent = activity || 'Processing…';
  progress.style.width = state === 'complete' ? '100%' : Math.min(95, Math.max(6, ((step + 1) / 9) * 100)) + '%';
  card.classList.toggle('running', state === 'running');
  card.classList.toggle('complete', state === 'complete');
}

function startExecutionClock() {
  executionStartedAt = Date.now();
  clearInterval(executionClock);
  executionClock = setInterval(() => {
    const el = $('#executionTime');
    if (el) el.textContent = Math.floor((Date.now() - executionStartedAt) / 1000) + 's';
  }, 250);
}

function stopExecutionClock() { clearInterval(executionClock); executionClock = null; }

function pipeline(step) {
  document.querySelectorAll('.step').forEach((node, index) => {
    node.classList.toggle('on', index === step);
    node.classList.toggle('done', index < step);
  });
}

function setStatus(text) {
  $('#commandState').textContent = text || '';
  if (text && /unavailable|failed|error|could not/i.test(text)) {
    $('#statusText').textContent = 'Attention required';
  } else if (!getState().command.running) {
    $('#statusText').textContent = 'NEXUS online';
  }
}

function renderUploads(files = []) {
  const tray = $('#uploadTray');
  const list = $('#uploadList');
  if (!tray || !list) return;

  if (!files.length) {
    tray.hidden = true;
    list.innerHTML = '';
    return;
  }

  tray.hidden = false;
  list.innerHTML = files.map((file, index) => {
    const name = escapeHtml(file.name || 'Uploaded file');
    const size = file.size ? formatFileSize(file.size) : '';
    const type = escapeHtml(file.mimeType || file.type || 'file');
    const icon = file.previewUrl && String(file.mimeType || '').startsWith('image/')
      ? '<img class="upload-thumb" src="' + file.previewUrl + '" alt="">'
      : '<span class="upload-file-icon">↳</span>';
    return '<div class="upload-item">' +
      icon +
      '<div class="upload-file-info"><b>' + name + '</b><small>' + type + (size ? ' · ' + size : '') + '</small></div>' +
      '<button class="upload-remove" type="button" data-upload-index="' + index + '" aria-label="Remove ' + name + '" title="Remove">×</button>' +
      '</div>';
  }).join('');

  list.querySelectorAll('.upload-remove').forEach(button => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.uploadIndex);
      uploadedFiles.splice(index, 1);
      renderUploads(uploadedFiles);
    });
  });
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '';
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return Math.round(value / 1024) + ' KB';
  return (value / (1024 * 1024)).toFixed(1) + ' MB';
}

const uploadedFiles = [];

function setMode(mode) {
  const label = mode?.name || mode?.label || (mode?.mode === 'JARVIS' ? 'Jarvis Mode' : 'GPT Mode');
  $('#mode').textContent = label;
  $('#mode2').textContent = label;
  setState({ mode: mode?.mode || 'GPT' });
}

async function loadWorkspace() {
  try {
    const [status, threads, artifacts, mode, active] = await Promise.all([
      api('/api/status'),
      api('/api/threads'),
      api('/api/artifacts'),
      api('/api/mode'),
      api('/api/threads/active')
    ]);

    $('#version').textContent = status.version || '—';
    $('#memory').textContent = (status.memoryFacts ?? 0) + ' facts';
    $('#modules').textContent = (status.modules || []).length;
    setMode(mode);

    setState({
      activeThreadId: threads.activeThreadId,
      authenticated: true
    });

    renderHistory(active);
    renderRecents(threads, { api, app, refresh: loadWorkspace });
    renderArtifacts(artifacts, $('#artifacts'));

    const toolsRoot = $('#toolsList');
    try {
      const tools = await api('/api/tools');
      toolsRoot.innerHTML = (tools.tools || []).map(tool =>
        '<div class="drawer-item"><span>' +
        escapeHtml(tool.name) +
        '</span><span class="tool-pill">' +
        escapeHtml(tool.risk || 'medium') +
        '</span></div>'
      ).join('') || '<div class="empty">No tools registered.</div>';
    } catch {
      toolsRoot.innerHTML = '<div class="empty">Tools unavailable.</div>';
    }

    $('#statusText').textContent = 'NEXUS online';
    if (!getState().command.running) $('#commandState').textContent = '';
  } catch (error) {
    $('#statusText').textContent = 'Runtime unavailable';
    setStatus(error.message || 'Could not load Sophie.');
  }
}

window.sophieLoadWorkspace = loadWorkspace;

function activityStep(activity) {
  const text = String(activity || '').toLowerCase();
  if (/understand|plan|listen/.test(text)) return 0;
  if (/decom|intent/.test(text)) return 1;
  if (/search|retriev|research|read/.test(text)) return 2;
  if (/run|execut|terminal|browser|using|hermes|write/.test(text)) return 3;
  if (/observ/.test(text)) return 4;
  if (/verif|check/.test(text)) return 5;
  if (/correct|retry|fix/.test(text)) return 6;
  if (/synth|answer|respond/.test(text)) return 7;
  return 3;
}

async function pollCommand(requestId) {
  clearInterval(statusPoll);
  statusPoll = setInterval(async () => {
    try {
      const task = await api('/api/command/status/' + encodeURIComponent(requestId));
      setStatus(task.activity || 'Working…');
      pipeline(activityStep(task.activity));
      if (task.status !== 'working' && task.status !== 'cancelling') {
        clearInterval(statusPoll);
      }
    } catch {
      // The command may have completed and been removed already.
    }
  }, 700);
}

async function send() {
  const text = input.value.trim();
  if ((!text && !uploadedFiles.length) || getState().command.running) return;

  const attachments = uploadedFiles.splice(0, uploadedFiles.length);
  renderUploads();
  input.value = '';
  input.style.height = '';
  const requestId = crypto.randomUUID();

  setState({
    command: {
      running: true,
      requestId,
      activity: 'Planning the task…',
      status: 'working'
    }
  });

  $('#send').classList.add('stop');
  $('#send').textContent = 'Stop';
  $('#send').setAttribute('aria-label', 'Stop Sophie');
  setStatus('Planning the task…');

  msg('user', text || 'Please analyze the attached file.', { attachments });
  activeOutput = msg('assistant', 'Planning and executing…', { plain: true });
  pipeline(0);
  pollCommand(requestId);

  try {
    const result = await api('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: text + (attachments.length
          ? '\n\nUSER ATTACHMENTS (inspect these files and answer the user question about their contents):\n' +
            attachments.map(file => '- ' + file.name + ' — workspace path: ' + file.path).join('\n')
          : ''),
        requestId
      })
    });

    pipeline(8);

    const answer = result.text ||
      result.response ||
      (result.data ? JSON.stringify(result.data, null, 2) : JSON.stringify(result, null, 2));

    activeOutput.querySelector('.body').innerHTML = formatAnswer(answer);
    const deliverables = Array.isArray(result.artifacts) ? result.artifacts : [];
    if (deliverables.length) {
      const gallery = document.createElement('div');
      gallery.className = 'assistant-artifacts';
      deliverables.forEach(item => {
        const rawPath = typeof item === 'string' ? item : (item.path || item.name || '');
        if (!rawPath) return;
        const name = typeof item === 'string' ? rawPath.split('/').pop() : (item.name || rawPath.split('/').pop());
        const url = '/api/artifacts/download?path=' + encodeURIComponent(rawPath);
        const card = document.createElement('a');
        card.className = 'assistant-artifact';
        card.href = url;
        card.target = '_blank';
        card.rel = 'noopener';
        const ext = rawPath.split('.').pop().toLowerCase();
        if (['png','jpg','jpeg','webp','gif','svg'].includes(ext)) {
          const image = document.createElement('img');
          image.src = url;
          image.alt = name;
          card.appendChild(image);
        } else {
          const icon = document.createElement('span');
          icon.className = 'assistant-artifact-icon';
          icon.textContent = ext === 'pdf' ? 'PDF' : 'FILE';
          card.appendChild(icon);
        }
        const label = document.createElement('span');
        label.textContent = name;
        card.appendChild(label);
        gallery.appendChild(card);
      });
      if (gallery.childElementCount) activeOutput.appendChild(gallery);
    }
    activeOutput.querySelector('.msg-actions')?.remove();
    addActions(activeOutput, 'assistant', answer);
  } catch (error) {
    const cancelled = /cancel|stopp/i.test(error.message || '');
    pipeline(cancelled ? 6 : 5);
    const answer = cancelled
      ? 'Stopped by you.'
      : 'I could not complete that task: ' + error.message;
    activeOutput.querySelector('.body').innerHTML = formatAnswer(answer);
    activeOutput.querySelector('.msg-actions')?.remove();
    addActions(activeOutput, 'assistant', answer);
  } finally {
    clearInterval(statusPoll);
    statusPoll = null;
    setState({
      command: {
        running: false,
        requestId: null,
        activity: '',
        status: 'idle'
      }
    });
    $('#send').classList.remove('stop');
    $('#send').textContent = 'Run ↗';
    $('#send').setAttribute('aria-label', 'Run task');
    setStatus('');
    await loadWorkspace();
  }
}

async function stopCommand() {
  const requestId = getState().command.requestId;
  if (!requestId) return;

  setStatus('Stopping…');
  try {
    await api('/api/command/' + encodeURIComponent(requestId) + '/cancel', { method: 'POST' });
  } catch (error) {
    setStatus('Could not stop: ' + error.message);
  }
}

function bindComposer() {
  $('#send')?.addEventListener('click', async () => {
    if (getState().command.running) return stopCommand();
    if (await ensureAccess()) await send();
  });

  subscribe(state => {
    const sendButton = $('#send');
    if (!sendButton) return;
    sendButton.disabled = state.ui.busy;
  });
}

const { ensureAccess } = initLogin({
  api,
  loadWorkspace
});

initRecents({ api, app, refresh: loadWorkspace });
initArtifacts({ app, root: $('#artifacts') });

$('#clearUploads')?.addEventListener('click', () => {
  uploadedFiles.length = 0;
  renderUploads();
});

initControls({
  api,
  app,
  ensureAccess,
  loadWorkspace,
  onUpload: file => {
    uploadedFiles.push(file);
    renderUploads(uploadedFiles);
  },
  onMessage: (role, text) => msg(role, text),
  setStatus,
  setMode
});

bindComposer();

ensureAccess().then(async authenticated => {
  if (authenticated) await loadWorkspace();
}).catch(error => {
  $('#statusText').textContent = error.message || 'Authentication unavailable';
});
