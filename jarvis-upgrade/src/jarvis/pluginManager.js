'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DIR = path.join(__dirname, '..', 'plugins');
const registry = new Map();
let loadErrors = [];
let pluginDir = DEFAULT_DIR;

function validate(plugin, file) {
  if (!plugin || typeof plugin !== 'object') throw new Error('must export an object');
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(String(plugin.name || ''))) throw new Error('"name" must be lowercase letters/numbers/dashes');
  if (typeof plugin.description !== 'string' || !plugin.description) throw new Error('"description" is required');
  if (typeof plugin.run !== 'function') throw new Error('"run" must be an async function');
  const triggers = Array.isArray(plugin.triggers) ? plugin.triggers : [];
  if (!triggers.length || !triggers.every(item => item instanceof RegExp)) throw new Error('"triggers" must be a non-empty array of RegExp');
  if (plugin.requires && !(Array.isArray(plugin.requires) && plugin.requires.every(item => typeof item === 'string'))) throw new Error('"requires" must be an array of binary names');
  if (plugin.risk && !['low', 'high'].includes(plugin.risk)) throw new Error('"risk" must be "low" or "high"');
  return { ...plugin, file, risk: plugin.risk || 'high', requires: plugin.requires || [] };
}

function load(dir = pluginDir) {
  pluginDir = dir;
  registry.clear();
  loadErrors = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter(name => name.endsWith('.js') && !name.startsWith('_')).sort(); } catch { return summary(); }

  for (const file of files) {
    const full = path.join(dir, file);
    try {
      delete require.cache[require.resolve(full)];
      const plugin = validate(require(full), file);
      if (registry.has(plugin.name)) throw new Error(`duplicate plugin name "${plugin.name}"`);
      registry.set(plugin.name, plugin);
    } catch (error) {
      loadErrors.push({ file, error: String(error.message || error).slice(0, 200) });
    }
  }
  return summary();
}

function summary() {
  return { loaded: [...registry.keys()], errors: [...loadErrors] };
}

function list() {
  return [...registry.values()].map(item => ({
    name: item.name, description: item.description, version: item.version || '1.0.0',
    risk: item.risk, requires: item.requires, file: item.file
  }));
}

function errors() { return [...loadErrors]; }

function match(command) {
  const text = String(command || '').trim();
  for (const plugin of registry.values()) {
    for (const trigger of plugin.triggers) {
      const result = trigger.exec(text);
      if (result) return { plugin, match: result };
    }
  }
  return null;
}

async function runPlugin(plugin, payload, timeoutMs = 120000) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`plugin timed out after ${timeoutMs / 1000}s`)), timeoutMs); });
  try {
    return await Promise.race([Promise.resolve(plugin.run(payload)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function describeAll() {
  const items = list();
  const lines = ['## Plugins'];
  if (!items.length) lines.push('No plugins installed yet.');
  for (const item of items) {
    lines.push(`- **${item.name}** v${item.version} — ${item.description}${item.requires.length ? ` (needs: ${item.requires.join(', ')})` : ''}${item.risk === 'high' ? ' · admin only' : ''}`);
  }
  for (const item of loadErrors) lines.push(`- ⚠️ ${item.file} failed to load: ${item.error}`);
  lines.push('', 'Say "create a plugin that <what you need>" and I will draft one for your approval.');
  return lines.join('\n');
}

module.exports = { load, list, errors, match, runPlugin, describeAll, DEFAULT_DIR };
