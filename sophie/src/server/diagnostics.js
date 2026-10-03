'use strict';

const os = require('node:os');

const startedAt = Date.now();
const counters = { requests: 0, errors: 0, completed: 0, cancelled: 0 };
const providers = new Map();

function recordRequest({ ok = true, cancelled = false } = {}) {
  counters.requests += 1;
  if (ok) counters.completed += 1;
  else counters.errors += 1;
  if (cancelled) counters.cancelled += 1;
}

function recordProvider(name, { ok = true, latencyMs = 0, error = null } = {}) {
  const key = String(name || 'unknown');
  const current = providers.get(key) || { calls: 0, successes: 0, failures: 0, totalLatencyMs: 0, lastError: null, lastAt: null };
  current.calls += 1;
  if (ok) current.successes += 1;
  else { current.failures += 1; current.lastError = String(error || 'unknown error').slice(0, 500); }
  current.totalLatencyMs += Math.max(0, Number(latencyMs) || 0);
  current.lastAt = new Date().toISOString();
  providers.set(key, current);
}

function snapshot() {
  const providerHealth = {};
  for (const [name, p] of providers) {
    providerHealth[name] = {
      ...p,
      averageLatencyMs: p.calls ? Math.round(p.totalLatencyMs / p.calls) : 0
    };
    delete providerHealth[name].totalLatencyMs;
  }
  return {
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    node: process.version,
    platform: process.platform,
    memory: {
      rss: process.memoryUsage().rss,
      heapUsed: process.memoryUsage().heapUsed,
      heapTotal: process.memoryUsage().heapTotal
    },
    load: os.loadavg(),
    counters: { ...counters },
    providers: providerHealth,
    checkedAt: new Date().toISOString()
  };
}

function providerSnapshot(name) {
  const all = snapshot().providers;
  return all[String(name || 'unknown')] || {
    calls: 0, successes: 0, failures: 0, averageLatencyMs: 0, lastError: null, lastAt: null
  };
}

module.exports = { recordRequest, recordProvider, snapshot, providerSnapshot };
