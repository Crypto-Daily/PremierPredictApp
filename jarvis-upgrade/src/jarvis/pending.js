'use strict';

const crypto = require('node:crypto');

const TTL_MS = 10 * 60 * 1000;
const store = new Map();
let lastCommand = null;

function sweep() {
  const now = Date.now();
  for (const [id, item] of store) if (item.expiresAt <= now) store.delete(id);
}

function create(type, payload = {}) {
  sweep();
  const id = crypto.randomBytes(2).toString('hex');
  store.set(id, { id, type, payload, createdAt: Date.now(), expiresAt: Date.now() + TTL_MS });
  return id;
}

function get(id) {
  sweep();
  return store.get(String(id || '').toLowerCase()) || null;
}

function latest(type) {
  sweep();
  const items = [...store.values()].filter(item => !type || item.type === type);
  return items.sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

function take(id) {
  const item = get(id);
  if (item) store.delete(item.id);
  return item;
}

function clear() {
  store.clear();
  lastCommand = null;
}

function setLastCommand(command) { lastCommand = command; }
function getLastCommand() { return lastCommand; }

module.exports = { create, get, latest, take, clear, setLastCommand, getLastCommand };
