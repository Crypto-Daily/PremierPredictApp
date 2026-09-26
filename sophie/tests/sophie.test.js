const assert = require('assert');

const selfInspect = require('../src/core/selfInspect');
const selfUpgrade = require('../src/core/selfUpgrade');
const { ModeManager } = require('../src/core/modeManager');
const { shouldDelegateToHermes } = require('../src/agent/agentPolicy');

assert.strictEqual(
  typeof selfInspect.findByName,
  'function',
  'findByName must be exported'
);

assert.strictEqual(
  typeof selfUpgrade.applyUpgrade,
  'function',
  'selfUpgrade.applyUpgrade must exist'
);

assert.strictEqual(
  typeof selfUpgrade.validateProject,
  'function',
  'selfUpgrade.validateProject must exist'
);

const validation = selfUpgrade.validateProject();

if (!validation.ok) {
  console.error(JSON.stringify(validation, null, 2));
  process.exit(1);
}

console.log('Sophie core tests passed.');
console.log(`Validated ${validation.checked} JavaScript files.`);

const modeManager = new ModeManager('/tmp/sophie-mode-test.json');
assert.strictEqual(modeManager.setMode('jarvis'), 'JARVIS');
assert.strictEqual(modeManager.getMode(), 'JARVIS');
assert.strictEqual(modeManager.setMode('gpt'), 'GPT');

assert.strictEqual(
  shouldDelegateToHermes({ command: 'create a DOCX document and save it', intent: 'CREATION', mode: 'GPT' }),
  true
);

assert.strictEqual(
  shouldDelegateToHermes({ command: 'what is the capital of France?', intent: 'CHAT', mode: 'GPT' }),
  false
);

assert.strictEqual(
  shouldDelegateToHermes({ command: 'help me inspect my screen', intent: 'CHAT', mode: 'JARVIS' }),
  true
);

console.log('Sophie mode and agent routing tests passed.');
