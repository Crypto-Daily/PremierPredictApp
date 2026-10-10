'use strict';

import { api } from './api.js';
import { initLogin } from './login.js';

const $ = selector => document.querySelector(selector);
const appRoot = $('#modelApp');
const form = $('#modelForm');
const list = $('#modelList');
const message = $('#formMessage');
let models = [];
let editingId = null;

function setMessage(text, error = false) {
  message.textContent = text || '';
  message.classList.toggle('error', error);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderModels() {
  list.replaceChildren();
  $('#modelCount').textContent = models.length + ' registered model' + (models.length === 1 ? '' : 's');
  if (!models.length) {
    list.append(el('div', 'model-empty', 'No models registered yet. Add your first model using the form.'));
    return;
  }

  for (const model of models) {
    const card = el('article', 'model-item');
    const head = el('div', 'model-item-head');
    const titleGroup = el('div');
    titleGroup.append(el('h3', '', model.name));
    titleGroup.append(el('div', 'model-meta', model.provider + ' · ' + model.model));
    head.append(titleGroup);
    head.append(el('span', 'model-status' + (model.enabled ? '' : ' off'), model.enabled ? 'Enabled' : 'Disabled'));
    card.append(head);
    card.append(el('div', 'model-meta', 'Adapter: ' + model.adapter + (model.endpoint ? ' · ' + model.endpoint : '')));
    const tags = el('div', 'model-tags');
    for (const capability of (model.capabilities || [])) tags.append(el('span', 'model-tag', capability));
    card.append(tags);
    if (model.notes) card.append(el('div', 'model-meta', model.notes));
    const actions = el('div', 'model-actions');
    const edit = el('button', '', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => beginEdit(model));
    actions.append(edit);
    if (model.adapter === 'openai-compatible') {
      const test = el('button', '', 'Test connection');
      test.type = 'button';
      test.addEventListener('click', () => testModel(model, test));
      actions.append(test);
    }
    if (model.id !== 'hermes-agent') {
      const remove = el('button', '', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', () => removeModel(model));
      actions.append(remove);
    }
    card.append(actions);
    list.append(card);
  }
}

async function loadModels() {
  list.replaceChildren(el('div', 'model-empty', 'Loading models…'));
  try {
    const result = await api('/api/models');
    models = Array.isArray(result.models) ? result.models : [];
    renderModels();
  } catch (error) {
    list.replaceChildren(el('div', 'model-empty', 'Could not load models: ' + error.message));
  }
}

function readForm() {
  const data = new FormData(form);
  return {
    name: String(data.get('name') || '').trim(),
    provider: String(data.get('provider') || '').trim(),
    model: String(data.get('model') || '').trim(),
    adapter: String(data.get('adapter') || 'metadata-only'),
    endpoint: String(data.get('endpoint') || '').trim(),
    envKey: String(data.get('envKey') || '').trim(),
    capabilities: String(data.get('capabilities') || 'text').split(',').map(x => x.trim().toLowerCase()).filter(Boolean),
    notes: String(data.get('notes') || '').trim(),
    enabled: data.get('enabled') === 'on'
  };
}

function beginEdit(model) {
  editingId = model.id;
  for (const field of ['name', 'provider', 'model', 'adapter', 'endpoint', 'envKey', 'notes']) {
    form.elements[field].value = model[field] || '';
  }
  form.elements.capabilities.value = (model.capabilities || []).join(', ');
  form.elements.enabled.checked = model.enabled !== false;
  $('#formTitle').textContent = 'Edit model';
  $('#saveModel').textContent = 'Save changes';
  $('#cancelEdit').hidden = false;
  setMessage('Editing ' + model.name);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  editingId = null;
  form.reset();
  form.elements.capabilities.value = 'text';
  form.elements.enabled.checked = true;
  $('#formTitle').textContent = 'Add a model';
  $('#saveModel').textContent = 'Add model';
  $('#cancelEdit').hidden = true;
  setMessage('');
}

async function testModel(model, button) {
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = 'Testing…';
  setMessage('Testing ' + model.name + ' connection…');
  try {
    const result = await api('/api/models/' + encodeURIComponent(model.id) + '/test', { method: 'POST' });
    if (result.verified) {
      setMessage(model.name + ' connection verified (' + result.model + ').');
    } else {
      setMessage(model.name + ' responded, but the exact verification phrase did not match.', true);
    }
  } catch (error) {
    setMessage('Test failed for ' + model.name + ': ' + error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
}

async function removeModel(model) {
  if (!window.confirm('Remove "' + model.name + '" from the registry? This does not uninstall the provider.')) return;
  try {
    await api('/api/models/' + encodeURIComponent(model.id), { method: 'DELETE' });
    if (editingId === model.id) resetForm();
    await loadModels();
    setMessage('Removed ' + model.name + ' from the registry.');
  } catch (error) {
    setMessage(error.message, true);
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const payload = readForm();
  $('#saveModel').disabled = true;
  setMessage(editingId ? 'Saving changes…' : 'Adding model…');
  try {
    if (editingId) {
      await api('/api/models/' + encodeURIComponent(editingId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setMessage('Model updated.');
    } else {
      await api('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setMessage('Model added to registry.');
    }
    resetForm();
    await loadModels();
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    $('#saveModel').disabled = false;
  }
});

$('#cancelEdit').addEventListener('click', resetForm);
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
