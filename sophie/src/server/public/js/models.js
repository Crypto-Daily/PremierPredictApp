'use strict';

import { api } from './api.js';
import { initLogin } from './login.js';

const $ = selector => document.querySelector(selector);
const appRoot = $('#modelApp');
let models = [];
let capabilities = [];
let projects = [];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text ?? '');
  return node;
}
function message(id, text, error = false) {
  const node = $(id);
  if (!node) return;
  node.textContent = text || '';
  node.classList.toggle('error', error);
}
function empty(list, text) {
  list.replaceChildren(el('div', 'model-empty', text));
}
function statusPill(text, off = false) {
  return el('span', 'state-pill' + (off ? ' off' : ''), text);
}
function addButton(parent, label, handler, className = 'action') {
  const button = el('button', className, label);
  button.type = 'button';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await handler(); } catch (error) { message('#capabilityMessage', error.message || 'Action failed.', true); }
    finally { button.disabled = false; }
  });
  parent.append(button);
  return button;
}

function renderSystemModels() {
  const list = $('#modelList');
  list.replaceChildren();
  $('#modelCount').textContent = models.length + ' in registry';
  if (!models.length) {
    empty(list, 'No model entries were returned by the system registry.');
    return;
  }
  for (const model of models) {
    const card = el('article', 'model-item');
    const head = el('div', 'model-item-head');
    const title = el('div');
    title.append(el('h3', '', model.name || model.id || 'Unnamed model'));
    title.append(el('div', 'model-meta', [model.provider, model.model || model.id].filter(Boolean).join(' · ') || 'Runtime-provided model'));
    head.append(title);
    head.append(statusPill(model.enabled === false ? 'Disabled' : 'Available', model.enabled === false));
    card.append(head);
    const details = [];
    if (model.adapter) details.push('Adapter: ' + model.adapter);
    if (model.endpoint) details.push('Endpoint: ' + model.endpoint);
    if (model.source) details.push('Source: ' + model.source);
    if (details.length) card.append(el('div', 'model-meta', details.join(' · ')));
    if (model.notes) card.append(el('div', 'model-meta', model.notes));
    const tags = el('div', 'model-tags');
    (Array.isArray(model.capabilities) ? model.capabilities : []).forEach(value => tags.append(el('span', 'model-tag', value)));
    if (tags.childElementCount) card.append(tags);
    list.append(card);
  }
}

function renderCapabilities() {
  const list = $('#capabilityList');
  list.replaceChildren();
  $('#capabilityCount').textContent = capabilities.length + ' registered';
  if (!capabilities.length) {
    empty(list, 'No user-created capabilities have been published yet. Start in the normal Sophie chat; verified factory registrations will appear here.');
    return;
  }
  for (const item of capabilities) {
    const card = el('article', 'model-item');
    const head = el('div', 'model-item-head');
    const title = el('div');
    title.append(el('h3', '', item.name || item.id || 'Unnamed capability'));
    title.append(el('div', 'model-meta', [item.type || item.kind || 'Created capability', item.version ? 'v' + item.version : ''].filter(Boolean).join(' · ')));
    head.append(title);
    head.append(statusPill(item.enabled ? 'Enabled' : (item.status || 'Registered'), !item.enabled));
    card.append(head);
    if (item.description) card.append(el('div', 'model-meta', item.description));
    if (item.verification) card.append(el('div', 'model-meta', 'Verification: ' + (item.verification.verified ? 'passed' : 'not confirmed')));
    const tags = el('div', 'model-tags');
    (Array.isArray(item.capabilities) ? item.capabilities : []).forEach(value => tags.append(el('span', 'model-tag', value)));
    if (tags.childElementCount) card.append(tags);
    const actions = el('div', 'row-actions');
    if (item.enabled) addButton(actions, 'Disable', async () => {
      await api('/api/factory/projects/' + encodeURIComponent(item.projectId || item.project_id || item.id) + '/disable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await loadFactory();
    });
    else if (item.projectId || item.project_id) addButton(actions, 'Enable (approval required)', async () => {
      const note = window.prompt('Confirm why this verified capability should be enabled:');
      if (!note || !note.trim()) return;
      await api('/api/factory/projects/' + encodeURIComponent(item.projectId || item.project_id) + '/enable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ authorized: true, authorizationNote: note.trim() }) });
      await loadFactory();
    });
    if (actions.childElementCount) card.append(actions);
    list.append(card);
  }
}

function renderProjects() {
  const list = $('#projectList');
  list.replaceChildren();
  $('#projectCount').textContent = projects.length + ' projects';
  if (!projects.length) {
    empty(list, 'No factory projects yet. Ask Sophie in chat to design a capability; the workflow should create and track the project here.');
    return;
  }
  for (const project of projects) {
    const id = project.id || project.projectId;
    const state = project.state || project.status || 'draft';
    const card = el('article', 'model-item factory-project');
    const head = el('div', 'model-item-head');
    const title = el('div');
    title.append(el('h3', '', project.name || project.title || 'Untitled project'));
    title.append(el('div', 'model-meta', id || 'Project ID unavailable'));
    head.append(title);
    head.append(statusPill(state, !['published', 'enabled', 'verified'].includes(String(state).toLowerCase())));
    card.append(head);
    if (project.description || project.goal) card.append(el('div', 'model-meta', project.description || project.goal));
    if (project.updatedAt || project.updated_at) card.append(el('div', 'model-meta', 'Updated: ' + (project.updatedAt || project.updated_at)));
    if (project.blueprint) card.append(el('div', 'model-meta', 'Blueprint: available for review'));
    const actions = el('div', 'row-actions');
    if (id && ['blueprint_ready', 'blueprint-ready', 'review'].includes(String(state).toLowerCase())) {
      addButton(actions, 'Review blueprint', async () => {
        const detail = await api('/api/factory/projects/' + encodeURIComponent(id));
        const blueprint = detail.project?.blueprint || detail.project?.blueprintJson || {};
        const text = JSON.stringify(blueprint, null, 2);
        const win = window.open('', '_blank', 'noopener,noreferrer');
        if (win) {
          const pre = win.document.createElement('pre');
          pre.textContent = text || 'No blueprint saved.';
          win.document.body.append(pre);
          win.document.title = 'Blueprint review — ' + (project.name || id);
        } else window.alert(text);
      });
      addButton(actions, 'Approve blueprint', async () => {
        if (!window.confirm('Approve this exact saved blueprint and allow the sandbox build to proceed?')) return;
        await api('/api/factory/projects/' + encodeURIComponent(id) + '/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved: true, notes: 'Explicitly approved in Model Studio.' }) });
        message('#capabilityMessage', 'Blueprint approval recorded. The next build step remains separate.');
        await loadFactory();
      }, 'action primary');
    }
    if (id && String(state).toLowerCase() === 'approved') {
      addButton(actions, 'Start sandbox build', async () => {
        if (!window.confirm('Start the approved sandbox build? This does not deploy to production.')) return;
        await api('/api/factory/projects/' + encodeURIComponent(id) + '/build/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        message('#capabilityMessage', 'Sandbox build started in the factory lifecycle.');
        await loadFactory();
      }, 'action primary');
    }
    if (id && ['enabled', 'published'].includes(String(state).toLowerCase())) {
      addButton(actions, 'Disable', async () => {
        await api('/api/factory/projects/' + encodeURIComponent(id) + '/disable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        await loadFactory();
      });
    }
    if (actions.childElementCount) card.append(actions);
    list.append(card);
  }
}

async function loadFactory() {
  const results = await Promise.allSettled([
    api('/api/factory/capabilities'),
    api('/api/factory/projects')
  ]);
  if (results[0].status === 'fulfilled') {
    capabilities = Array.isArray(results[0].value.capabilities) ? results[0].value.capabilities : [];
    renderCapabilities();
  } else {
    empty($('#capabilityList'), 'Created-capability registry unavailable: ' + results[0].reason.message);
    $('#capabilityCount').textContent = 'Unavailable';
  }
  if (results[1].status === 'fulfilled') {
    projects = Array.isArray(results[1].value.projects) ? results[1].value.projects : [];
    renderProjects();
  } else {
    empty($('#projectList'), 'Factory projects unavailable: ' + results[1].reason.message);
    $('#projectCount').textContent = 'Unavailable';
  }
}

async function loadModels() {
  $('#refreshModels').disabled = true;
  $('#refreshModels').classList.add('spinner');
  empty($('#modelList'), 'Loading system registry…');
  try {
    const result = await api('/api/models');
    models = Array.isArray(result.models) ? result.models : [];
    renderSystemModels();
    message('#systemMessage', '');
  } catch (error) {
    empty($('#modelList'), 'Could not load system registry: ' + error.message);
    $('#modelCount').textContent = 'Unavailable';
    message('#systemMessage', 'System model list could not be retrieved.', true);
  }
  try { await loadFactory(); }
  finally {
    $('#refreshModels').disabled = false;
    $('#refreshModels').classList.remove('spinner');
  }
}

$('#refreshModels').addEventListener('click', loadModels);

const login = initLogin({
  api,
  loadWorkspace: async () => {
    appRoot.hidden = false;
    await loadModels();
  }
});
login.ensureAccess().then(async authenticated => {
  if (authenticated) {
    appRoot.hidden = false;
    await loadModels();
  }
}).catch(error => {
  $('#loginErr').textContent = error.message || 'Authentication unavailable.';
  $('#login').hidden = false;
});
