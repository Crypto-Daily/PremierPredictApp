'use strict';

const assert = require('node:assert/strict');
const { validateEndpoint } = require('../src/models/modelRuntime');

assert.equal(validateEndpoint('http://127.0.0.1:8788/v1'), 'http://127.0.0.1:8788/v1');
assert.equal(validateEndpoint('https://api.example.com/v1'), 'https://api.example.com/v1');
assert.throws(() => validateEndpoint('http://example.com/v1'), /loopback/);
assert.throws(() => validateEndpoint('file:///etc/passwd'), /HTTP\(S\)/);
assert.throws(() => validateEndpoint('https://user:pass@example.com/v1'), /credentials/);
assert.throws(() => validateEndpoint('https://127.0.0.1/v1'), /public DNS hostname/);

console.log('Model runtime endpoint tests passed.');
