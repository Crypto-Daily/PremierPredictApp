'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const skip = new Set(['node_modules', '.git', 'data', 'logs', 'workspace', 'backups']);
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && full.endsWith('.js')) files.push(full);
  }
}
walk(root);
files.sort();

let syntaxFailures = 0;
console.log('=== SOPHIE DEBUG: syntax scan ===');
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    syntaxFailures++;
    console.log('\n[SYNTAX FAIL] ' + path.relative(root, file));
    console.log((r.stderr || r.stdout || '').trim());
  }
}
console.log('\nSyntax scan: ' + (syntaxFailures ? syntaxFailures + ' failure(s)' : 'PASS'));

const testsDir = path.join(root, 'tests');
const tests = fs.readdirSync(testsDir).filter(name => name.endsWith('.test.js')).sort();
let testFailures = 0;
console.log('\n=== SOPHIE DEBUG: isolated test runs ===');
for (const name of tests) {
  const r = spawnSync(process.execPath, [path.join(testsDir, name)], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) {
    testFailures++;
    console.log('\n[TEST FAIL] ' + name);
    console.log((r.stdout || '').trim());
    console.log((r.stderr || '').trim());
  } else console.log('[PASS] ' + name);
}
console.log('\n=== SOPHIE DEBUG SUMMARY ===');
console.log('JavaScript files scanned: ' + files.length);
console.log('Syntax failures: ' + syntaxFailures);
console.log('Tests run: ' + tests.length);
console.log('Test failures: ' + testFailures);
process.exitCode = syntaxFailures || testFailures ? 1 : 0;
