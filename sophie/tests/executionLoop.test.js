'use strict';
const assert = require('node:assert/strict');
const { executeLoop } = require('../src/nexus/executionLoop');
(async () => {
  let attempts = 0;
  const result = await executeLoop({
    plan: { steps: ['work'] },
    maxIterations: 2,
    execute: async () => ({ text: 'attempt ' + (++attempts) }),
    verify: async ({ iteration }) => ({ ok: iteration === 2 }),
    correct: async () => ({ action: 'retry' })
  });
  assert.equal(result.ok, true);
  assert.equal(result.iterations, 2);
  assert.ok(result.history.some(x => x.phase === 'CORRECT'));
  console.log('NEXUS execution loop tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
