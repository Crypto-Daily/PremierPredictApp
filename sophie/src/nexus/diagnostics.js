'use strict';

const diagnostics = require('../server/diagnostics');

function diagnose({ provider } = {}) {
  const health = provider ? diagnostics.providerSnapshot(provider) : diagnostics.snapshot();
  const findings = [];
  if (health.memory?.heapTotal && health.memory.heapUsed / health.memory.heapTotal > 0.9) findings.push('High Node.js heap utilization.');
  if (health.providers) {
    for (const [name, p] of Object.entries(health.providers)) {
      if (p.failures > 0 && p.failures >= p.successes) findings.push('Provider failure rate is elevated: ' + name);
    }
  }
  return { ok: findings.length === 0, health, findings };
}

module.exports = { diagnose };
