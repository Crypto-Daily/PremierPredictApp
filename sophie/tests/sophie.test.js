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

assert.strictEqual(
  selfUpgrade.normalizeProjectPath('src/core/selfUpgrade.js').relative,
  'src/core/selfUpgrade.js',
  'self-upgrade should accept an in-scope source file'
);

assert.throws(
  () => selfUpgrade.normalizeProjectPath('../.env'),
  /restricted to src/,
  'self-upgrade must reject paths outside src/'
);

assert.throws(
  () => selfUpgrade.normalizeProjectPath('package.json'),
  /restricted to src/,
  'self-upgrade must not modify project configuration files'
);

// Parse the inline browser application script without executing browser code.
const fs = require('fs');
const path = require('path');
const htmlPath = path.join(__dirname, '../src/server/public/index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scripts = [...html.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/gi)];
assert(scripts.length > 0, 'Sophie UI should contain its application script');
assert.doesNotThrow(
  () => new Function(scripts[scripts.length - 1][1]),
  'Sophie UI inline JavaScript must parse successfully'
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
