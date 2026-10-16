'use strict';

// Optional Docker-backed verification runner. It executes only a narrow set of
// Node checks in a disposable, network-isolated container. It does not publish,
// enable, deploy, or run arbitrary caller-supplied shell commands.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const MAX_FILES = 120;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_TIMEOUT_MS = 90_000;
const DEFAULT_IMAGE = process.env.SOPHIE_FACTORY_SANDBOX_IMAGE || 'node:20-alpine';

function validateRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 240) throw new Error('Each file requires a relative path (max 240 characters).');
  if (value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value)) throw new Error('Unsafe file path.');
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe file path.');
  if (!/^[a-zA-Z0-9._/-]+$/.test(value)) throw new Error('File path contains unsupported characters.');
  return value;
}

function writeWorkspace(root, files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) throw new Error('files must contain 1 to ' + MAX_FILES + ' entries.');
  let total = 0;
  for (const file of files) {
    const rel = validateRelativePath(file.path);
    if (typeof file.content !== 'string') throw new Error('File content must be text.');
    const size = Buffer.byteLength(file.content, 'utf8');
    if (size > MAX_FILE_BYTES) throw new Error('File exceeds per-file size limit: ' + rel);
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new Error('Workspace exceeds total size limit.');
    const destination = path.resolve(root, ...rel.split('/'));
    if (!destination.startsWith(root + path.sep)) throw new Error('File escapes workspace.');
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, file.content, { flag: 'wx', mode: 0o600 });
  }
}

function runDocker(args, { timeoutMs = MAX_TIMEOUT_MS, cwd } = {}) {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn('docker', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '/usr/bin:/bin' } });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, exitCode: null, timedOut: true, stdout: stdout.slice(-12000), stderr: (stderr + '\nSandbox command timed out.').slice(-12000) });
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-12000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.on('error', error => {
      clearTimeout(timer);
      finish({ ok: false, exitCode: null, timedOut: false, stdout, stderr: (stderr + '\n' + error.message).slice(-12000) });
    });
    child.on('close', code => {
      clearTimeout(timer);
      finish({ ok: code === 0, exitCode: code, timedOut: false, stdout, stderr });
    });
  });
}

async function verifyFiles({ files, timeoutMs = 45_000 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophie-factory-' + randomUUID() + '-'));
  try {
    writeWorkspace(root, files);
    const timeout = Math.max(1000, Math.min(Number(timeoutMs) || 45_000, MAX_TIMEOUT_MS));
    // The image must already exist locally; do not let the runner pull arbitrary
    // images or access a registry from the host.
    const imageCheck = await runDocker(['image', 'inspect', DEFAULT_IMAGE], { timeoutMs: 5000 });
    if (!imageCheck.ok) {
      return { ok: false, verified: false, stage: 'sandbox_preflight', exitCode: imageCheck.exitCode, timedOut: imageCheck.timedOut, stdout: imageCheck.stdout, stderr: imageCheck.stderr, note: 'Required sandbox image is not available locally; image pulls are intentionally not automatic.' };
    }
    const args = [
      'run', '--rm', '--network=none', '--read-only',
      '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--pids-limit=64', '--memory=512m', '--cpus=1',
      '--user=10001:10001', '--tmpfs=/tmp:rw,noexec,nosuid,size=32m',
      '--mount', 'type=bind,src=' + root + ',dst=/workspace,rw',
      '--workdir=/workspace', '--env=NODE_ENV=test',
      DEFAULT_IMAGE, 'sh', '-lc',
      'set -eu; find . -type f -name "*.js" -print0 | xargs -0 -r -n1 node --check; if [ -f package.json ]; then node -e "const p=require(\'./package.json\'); if(p.scripts && p.scripts.test) process.exit(0); process.exit(2)" && npm test; elif [ -f tests/run.js ]; then node tests/run.js; fi'
    ];
    const result = await runDocker(args, { timeoutMs: timeout, cwd: root });
    return {
      ...result,
      verified: result.ok === true && result.timedOut !== true && result.exitCode === 0,
      stage: 'sandbox_tests',
      sandbox: 'docker-network-none-readonly-root',
      image: DEFAULT_IMAGE
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { verifyFiles, validateRelativePath, writeWorkspace };
