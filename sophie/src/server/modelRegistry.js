'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const REGISTRY_PATH = process.env.SOPHIE_MODEL_REGISTRY ||
  path.join(process.cwd(), 'data', 'model-registry.json');

const DEFAULT_MODELS = [
  { id: 'hermes-agent', name: 'Hermes Agent', provider: 'Hermes CLI', model: 'configured-by-hermes', adapter: 'hermes-cli', capabilities: ['text', 'reasoning', 'tools', 'research', 'files', 'code', 'image', 'video'], enabled: true, notes: 'Primary agent. Hermes chooses its configured model and tools.' },
  { id: 'meta-ai', name: 'Meta AI', provider: 'WhatsApp bridge', model: 'meta-ai', adapter: 'openai-compatible', endpoint: 'http://127.0.0.1:8788/v1', capabilities: ['text', 'image'], enabled: true, notes: 'Existing local bridge; availability depends on the bridge service.' },
  { id: 'gemini', name: 'Google Gemini', provider: 'Google', model: 'configured-by-environment', adapter: 'provider-router', capabilities: ['text', 'vision', 'research'], enabled: true, notes: 'Existing legacy provider adapter; credentials remain in environment variables.' },
  { id: 'openrouter', name: 'OpenRouter', provider: 'OpenRouter', model: 'configured-by-environment', adapter: 'provider-router', capabilities: ['text'], enabled: true, notes: 'Existing legacy provider adapter; credentials remain in environment variables.' }
];

function ensureRegistry() {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  if (!fs.existsSync(REGISTRY_PATH)) {
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify({ version: 1, models: DEFAULT_MODELS }, null, 2) + '\n', { mode: 0o600 });
  }
}

function readRegistry() {
  ensureRegistry();
  const parsed = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  return { version: 1, models: Array.isArray(parsed.models) ? parsed.models : [] };
}

function writeRegistry(registry) {
  ensureRegistry();
  const temporary = REGISTRY_PATH + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, models: registry.models }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, REGISTRY_PATH);
}

function cleanModel(input, existing = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const name = String(value.name ?? existing.name ?? '').trim().slice(0, 100);
  const provider = String(value.provider ?? existing.provider ?? '').trim().slice(0, 100);
  const model = String(value.model ?? existing.model ?? '').trim().slice(0, 180);
  const adapter = String(value.adapter ?? existing.adapter ?? 'metadata-only').trim().slice(0, 60);
  const allowedAdapters = new Set(['hermes-cli', 'openai-compatible', 'provider-router', 'metadata-only']);
  if (!name || !provider || !model) throw new Error('Name, provider, and model ID are required.');
  if (!allowedAdapters.has(adapter)) throw new Error('Unsupported adapter type.');
  const capabilities = Array.isArray(value.capabilities ?? existing.capabilities)
    ? [...new Set((value.capabilities ?? existing.capabilities).map(x => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, 20)
    : ['text'];
  const endpointRaw = String(value.endpoint ?? existing.endpoint ?? '').trim();
  let endpoint = '';
  if (endpointRaw) {
    let parsed;
    try { parsed = new URL(endpointRaw); } catch { throw new Error('Endpoint must be a valid HTTP(S) URL.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Endpoint must use HTTP or HTTPS.');
    endpoint = parsed.toString().replace(/\/$/, '');
  }
  const envKey = String(value.envKey ?? existing.envKey ?? '').trim();
  if (envKey && !/^[A-Z][A-Z0-9_]{1,100}$/.test(envKey)) throw new Error('Environment variable name is invalid.');
  return {
    id: String(existing.id || value.id || randomUUID()),
    name, provider, model, adapter, capabilities,
    ...(endpoint ? { endpoint } : {}),
    ...(envKey ? { envKey } : {}),
    enabled: value.enabled === undefined ? existing.enabled !== false : value.enabled === true,
    notes: String(value.notes ?? existing.notes ?? '').trim().slice(0, 1000)
  };
}

function modelRoutes(app) {
  app.post('/api/models/:id/test', async (req, res) => {
    try {
      const { testModel } = require('../models/modelRuntime');
      const result = await testModel(req.params.id);
      res.json(result);
    } catch (error) {
      res.status(502).json({ ok: false, error: String(error.message || 'Model test failed.').slice(0, 600) });
    }
  });

  app.post('/api/models/:id/invoke', async (req, res) => {
    try {
      const { invokeModel } = require('../models/modelRuntime');
      const result = await invokeModel({ modelId: req.params.id, prompt: req.body?.prompt, system: req.body?.system, timeoutMs: req.body?.timeoutMs });
      res.json(result);
    } catch (error) {
      res.status(502).json({ ok: false, error: String(error.message || 'Model invocation failed.').slice(0, 600) });
    }
  });

  app.get('/api/models', (req, res) => {
    try {
      const registry = readRegistry();
      res.json({ version: registry.version, models: registry.models });
    } catch (error) {
      console.error('[MODELS] read failed:', error.message);
      res.status(500).json({ error: 'Could not read model registry.' });
    }
  });

  app.post('/api/models', (req, res) => {
    try {
      const registry = readRegistry();
      const model = cleanModel(req.body || {});
      if (registry.models.some(item => item.id === model.id)) return res.status(409).json({ error: 'A model with this ID already exists.' });
      registry.models.push(model);
      writeRegistry(registry);
      auditSafe('model.created', { id: model.id, provider: model.provider, adapter: model.adapter });
      res.status(201).json({ ok: true, model });
    } catch (error) {
      res.status(400).json({ error: error.message || 'Could not add model.' });
    }
  });

  app.put('/api/models/:id', (req, res) => {
    try {
      const registry = readRegistry();
      const index = registry.models.findIndex(item => item.id === req.params.id);
      if (index < 0) return res.status(404).json({ error: 'Model not found.' });
      const model = cleanModel(req.body || {}, registry.models[index]);
      model.id = registry.models[index].id;
      registry.models[index] = model;
      writeRegistry(registry);
      auditSafe('model.updated', { id: model.id, provider: model.provider });
      res.json({ ok: true, model });
    } catch (error) {
      res.status(400).json({ error: error.message || 'Could not update model.' });
    }
  });

  app.delete('/api/models/:id', (req, res) => {
    try {
      const registry = readRegistry();
      const model = registry.models.find(item => item.id === req.params.id);
      if (!model) return res.status(404).json({ error: 'Model not found.' });
      if (model.id === 'hermes-agent') return res.status(400).json({ error: 'The primary Hermes agent entry cannot be deleted. You can disable other model entries.' });
      registry.models = registry.models.filter(item => item.id !== req.params.id);
      writeRegistry(registry);
      auditSafe('model.deleted', { id: model.id });
      res.json({ ok: true, id: model.id });
    } catch (error) {
      res.status(500).json({ error: 'Could not delete model.' });
    }
  });
}

function auditSafe(event, details) {
  try {
    const { audit } = require('./security');
    audit(event, details);
  } catch {}
}

module.exports = { modelRoutes, readRegistry, REGISTRY_PATH };
