'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateRelativePath, writeWorkspace } = require('../src/factory/sandboxRunner');

assert.equal(validateRelativePath('src/index.js'), 'src/index.js');
assert.throws(() => validateRelativePath('../outside.js'), /Unsafe file path/);
assert.throws(() => validateRelativePath('/etc/passwd'), /Unsafe file path/);
assert.throws(() => validateRelativePath('src\\\\index.js'), /Unsafe file path/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophie-sandbox-test-'));
try {
  writeWorkspace(root, [{ path: 'src/index.js', content: 'console.log("ok");\n' }]);
  assert.equal(fs.readFileSync(path.join(root, 'src/index.js'), 'utf8'), 'console.log("ok");\n');
  assert.throws(() => writeWorkspace(root, [{ path: 'src/index.js', content: 'overwrite' }]), /EEXIST/);
  assert.throws(() => writeWorkspace(root, [{ path: 'large.js', content: 'x'.repeat(300000) }]), /per-file size limit/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Sophie sandbox runner input tests passed.');
