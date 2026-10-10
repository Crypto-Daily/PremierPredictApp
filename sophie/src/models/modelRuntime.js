'use strict';

const net = require('node:net');
const { readRegistry } = require('../server/modelRegistry');

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_PROMPT_CHARS = 40000;

function validateEndpoint(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Model endpoint is not a valid URL.'); }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Model endpoint must not contain credentials, query parameters, or fragments.');
  }
  const host = url.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  if (url.protocol === 'http:' && !loopback) {
    throw new Error('HTTP endpoints are allowed only for loopback services. Use HTTPS for remote providers.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) model endpoints are supported.');
  if (url.protocol === 'https:' && (loopback || net.isIP(host.replace(/^\[|\]$/g, '')))) {
    throw new Error('HTTPS endpoint must use a public DNS hostname, not localhost or an IP literal.');
  }
  return url.toString().replace(/\/$/, '');
}

function resolveModel(id) {
  const model = readRegistry().models.find(item => item.id === id);
  if (!model) throw new Error('Model not found.');
  if (!model.enabled) throw new Error('Model is disabled.');
  if (model.adapter !== 'openai-compatible') {
    throw new Error('This model adapter is not executable through the OpenAI-compatible runtime.');
  }
  if (!model.endpoint) throw new Error('Model endpoint is not configured.');
  return model;
}

async function invokeModel({ modelId, prompt, system = 'You are a helpful assistant.', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('A non-empty prompt is required.');
  if (prompt.length > MAX_PROMPT_CHARS) throw new Error('Prompt exceeds the 40,000 character limit.');
  const model = resolveModel(modelId);
  const endpoint = validateEndpoint(model.endpoint);
  const base = endpoint.replace(/\/$/, '');
  const url = base.endsWith('/chat/completions') ? base : base + '/chat/completions';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), 60000));
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (model.envKey) {
      const secret = process.env[model.envKey];
      if (!secret) throw new Error('Configured credential environment variable is not set: ' + model.envKey);
      headers.Authorization = 'Bearer ' + secret;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: model.model,
        messages: [
          { role: 'system', content: String(system).slice(0, 8000) },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2
      })
    });
    const raw = await response.text();
    let payload;
    try { payload = JSON.parse(raw); } catch { payload = null; }
    if (!response.ok) {
      const message = payload?.error?.message || payload?.error || ('HTTP ' + response.status);
      throw new Error('Model provider request failed: ' + String(message).slice(0, 500));
    }
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('Provider returned no text content.');
    return { ok: true, modelId: model.id, model: model.model, provider: model.provider, text, usage: payload.usage || null };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Model provider timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function testModel(modelId) {
  const result = await invokeModel({ modelId, system: 'You are a connection test. Follow the user instruction exactly.', prompt: 'Reply with exactly: MODEL_RUNTIME_OK', timeoutMs: 15000 });
  return { ok: true, modelId: result.modelId, provider: result.provider, model: result.model, response: result.text, verified: result.text.trim() === 'MODEL_RUNTIME_OK' };
}

module.exports = { invokeModel, testModel, validateEndpoint };
