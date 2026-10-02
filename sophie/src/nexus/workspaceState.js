'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(process.env.SOPHIE_STATE_DIR || path.join(process.cwd(), 'data', 'nexus'));
const TASK_DIR = path.join(ROOT, 'tasks');

function ensure() { fs.mkdirSync(TASK_DIR, { recursive: true }); }
function safeId(id) { if (!/^[a-zA-Z0-9_-]{1,100}$/.test(String(id || ''))) throw new Error('Invalid task id.'); return String(id); }
function fileFor(id) { ensure(); return path.join(TASK_DIR, safeId(id) + '.json'); }

function saveTask(state) {
  if (!state?.id) throw new Error('Task state id is required.');
  const record = { ...state, persistedAt: new Date().toISOString() };
  const target = fileFor(record.id);
  const temp = target + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(record, null, 2), 'utf8');
  fs.renameSync(temp, target);
  return record;
}

function loadTask(id) {
  const target = fileFor(id);
  if (!fs.existsSync(target)) return null;
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

function listTasks({ status, limit = 50 } = {}) {
  ensure();
  return fs.readdirSync(TASK_DIR).filter(x => x.endsWith('.json')).map(x => {
    try { return JSON.parse(fs.readFileSync(path.join(TASK_DIR, x), 'utf8')); } catch { return null; }
  }).filter(Boolean).filter(x => !status || x.status === status).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, limit);
}

function checkpoint(state, label, data = {}) {
  return saveTask({ ...state, checkpoint: { label, at: new Date().toISOString(), ...data } });
}

function removeTask(id) {
  const target = fileFor(id);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}

module.exports = { ROOT, saveTask, loadTask, listTasks, checkpoint, removeTask };
