const assert = require('assert');

const selfInspect = require('../src/core/selfInspect');
const selfUpgrade = require('../src/core/selfUpgrade');

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
