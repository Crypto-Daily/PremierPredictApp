'use strict';

const { spawn } = require('node:child_process');

const MAX_OUTPUT = 20000;
const DEFAULT_TIMEOUT = 15000;

function runNode(code, { timeoutMs = DEFAULT_TIMEOUT } = {}) {
  if (typeof code !== 'string' || !code.trim()) throw new Error('Code is required.');
  if (code.length > 50000) throw new Error('Code exceeds the execution limit.');

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH || '' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '', settled = false;
    const finish = result => { if (!settled) { settled = true; resolve(result); } };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, timedOut: true, stdout: stdout.slice(0, MAX_OUTPUT), stderr: 'Execution timed out.' });
    }, Math.min(Math.max(timeoutMs, 1000), 30000));

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      finish({ ok: code === 0, exitCode: code, stdout: stdout.slice(0, MAX_OUTPUT), stderr: stderr.slice(0, MAX_OUTPUT) });
    });
  });
}

module.exports = { runNode };
