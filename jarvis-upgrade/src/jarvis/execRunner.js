'use strict';

const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { cleanEnv, redactSecrets, truncateOutput } = require('./sensitive');

const SHELL = '/bin/bash';
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 300000;

// Unambiguous CLI names: "run <tool> ..." is treated as a shell command only for these.
const KNOWN_TOOLS = new Set([
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno', 'tsc', 'pm2', 'psql', 'pg_dump', 'pg_restore',
  'redis-cli', 'mongosh', 'mysql', 'sqlite3', 'git', 'docker', 'python', 'python3', 'pip', 'pip3',
  'curl', 'wget', 'systemctl', 'journalctl', 'apt', 'apt-get', 'dpkg', 'ls', 'cat', 'tail', 'grep',
  'ps', 'df', 'du', 'free', 'uptime', 'uname', 'whoami', 'hostname', 'ss', 'netstat', 'ping', 'dig',
  'nslookup', 'nginx', 'certbot', 'ufw', 'jq', 'tar', 'zip', 'unzip', 'crontab', 'lsof', 'htop', 'top',
  'pwd', 'echo', 'wc', 'openssl', 'bash', 'sh', 'java', 'go', 'cargo', 'rustc', 'php', 'ruby',
  'ffmpeg', 'pandoc', 'soffice', 'libreoffice', 'cd', 'sudo', 'which', 'date', 'id', 'stat', 'file',
  'ip', 'ifconfig', 'traceroute', 'rsync', 'scp', 'vim', 'nano', 'less', 'tree'
]);

// binary -> apt package (null = not installable through plain apt)
const APT_PACKAGES = {
  psql: 'postgresql-client', pg_dump: 'postgresql-client', pg_restore: 'postgresql-client',
  'redis-cli': 'redis-tools', mysql: 'mysql-client', sqlite3: 'sqlite3', jq: 'jq', htop: 'htop',
  ffmpeg: 'ffmpeg', unzip: 'unzip', zip: 'zip', nginx: 'nginx', certbot: 'certbot', python3: 'python3',
  python: 'python3', pip: 'python3-pip', pip3: 'python3-pip', git: 'git', curl: 'curl', wget: 'wget',
  docker: 'docker.io', java: 'default-jre', php: 'php-cli', ruby: 'ruby', go: 'golang-go', lsof: 'lsof',
  dig: 'dnsutils', nslookup: 'dnsutils', netstat: 'net-tools', ifconfig: 'net-tools', ss: 'iproute2',
  ip: 'iproute2', ufw: 'ufw', convert: 'imagemagick', soffice: 'libreoffice', libreoffice: 'libreoffice',
  pandoc: 'pandoc', tree: 'tree', rsync: 'rsync', traceroute: 'traceroute', ping: 'iputils-ping',
  openssl: 'openssl', cargo: 'cargo', rustc: 'rustc', tsc: null, node: null, npm: null, npx: null,
  pnpm: null, yarn: null, bun: null, deno: null, pm2: null, mongosh: null
};

const MANUAL_INSTALL_HINT = {
  node: 'Node.js is best installed with nvm or NodeSource, not plain apt.',
  npm: 'npm comes with Node.js (nvm or NodeSource).',
  npx: 'npx comes with Node.js (nvm or NodeSource).',
  pm2: 'Install it with: npm install -g pm2',
  pnpm: 'Install it with: npm install -g pnpm',
  yarn: 'Install it with: npm install -g yarn',
  tsc: 'Install it with: npm install -g typescript',
  mongosh: 'mongosh needs the MongoDB apt repository or the tarball from mongodb.com.',
  bun: 'Install it with: npm install -g bun',
  deno: 'Install it from deno.land.'
};

const SHELL_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'for', 'case', 'esac', 'in',
  'select', 'function', '{', '}', '[[', ']]', '!'
]);

function parseExecRequest(text) {
  const raw = String(text || '').trim();

  let m = /^\$\s*(.+)$/s.exec(raw);
  if (m) return { command: m[1].trim(), forced: true };

  m = /^(?:please\s+)?(?:(?:run|execute|exec)\s+(?:the\s+)?(?:shell\s+|bash\s+)?command|(?:bash|shell|sh|cmd|terminal)\s*:|exec(?:ute)?)\s*[:\s]\s*(.+)$/is.exec(raw);
  if (m) return { command: m[1].trim().replace(/^`+|`+$/g, ''), forced: true };

  m = /^(?:please\s+|can you\s+|could you\s+)?run\s+(.+)$/is.exec(raw);
  if (m) {
    const command = m[1].trim().replace(/^`+|`+$/g, '');
    const first = command.split(/\s+/)[0].replace(/^["']|["']$/g, '');
    if (/\s+(?:in|with|under|via)\s+pm2\s*$/i.test(command)) return null;
    if (KNOWN_TOOLS.has(first) || /^(?:\.\/|\/|~\/)/.test(first)) return { command, forced: false };
  }
  return null;
}

function splitSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;
  const text = String(command || '');

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"') { current += ch + (text[++i] || ''); continue; }
      current += ch;
      continue;
    }
    if (ch === '\\') { current += ch + (text[++i] || ''); continue; }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if ('|&;\n()`'.includes(ch)) { segments.push(current); current = ''; continue; }
    current += ch;
  }
  segments.push(current);
  return segments.map(item => item.trim()).filter(Boolean);
}

function firstCommandWord(segment) {
  const tokens = segment.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) { i++; continue; }
    if (token === 'sudo') {
      i++;
      while (i < tokens.length && tokens[i].startsWith('-')) {
        i += (tokens[i] === '-u' || tokens[i] === '-g') ? 2 : 1;
      }
      continue;
    }
    if (['time', 'nohup', 'nice', 'command', 'exec'].includes(token)) { i++; continue; }
    if (token === 'timeout') { i += 2; continue; }
    if (/^\d*[<>]/.test(token)) { i++; continue; }
    return token.replace(/^["']|["']$/g, '');
  }
  return null;
}

function referencedBinaries(command) {
  const names = [];
  for (const segment of splitSegments(command)) {
    const word = firstCommandWord(segment);
    if (!word || SHELL_KEYWORDS.has(word)) continue;
    if (/^[<>]/.test(word) || word.startsWith('$') || word.includes('=')) continue;
    if (!names.includes(word)) names.push(word);
  }
  return names;
}

const existsCache = new Map();

function commandExists(name) {
  const key = String(name);
  const cached = existsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);

  return new Promise(resolve => {
    const finish = value => {
      existsCache.set(key, { value, expiresAt: Date.now() + 30000 });
      resolve(value);
    };
    if (key.includes('/')) {
      const expanded = key.startsWith('~/') ? key.replace('~', os.homedir()) : key;
      try { fs.accessSync(expanded, fs.constants.X_OK); return finish(true); } catch { return finish(false); }
    }
    execFile(SHELL, ['-lc', 'type -t -- "$1"', '_', key], { timeout: 8000, env: cleanEnv() }, (error, stdout) => {
      finish(!error && String(stdout).trim().length > 0);
    });
  });
}

async function findMissingTools(command) {
  const missing = [];
  for (const name of referencedBinaries(command)) {
    if (!(await commandExists(name))) missing.push(name);
  }
  return missing;
}

function runShell(command, { timeoutMs = DEFAULT_TIMEOUT_MS, signal = null, cwd = os.homedir() } = {}) {
  const limit = Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);

  return new Promise(resolve => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    const MAX_CAPTURE = 400000;

    const child = spawn(SHELL, ['-lc', command], {
      cwd, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true
    });

    const killGroup = () => {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } }, 3000).unref();
    };

    const timer = setTimeout(() => { timedOut = true; killGroup(); }, limit);
    const onAbort = () => { aborted = true; killGroup(); };
    if (signal) {
      if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { if (stdout.length < MAX_CAPTURE) stdout += chunk; });
    child.stderr.on('data', chunk => { if (stderr.length < MAX_CAPTURE) stderr += chunk; });

    child.on('error', error => {
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr: stderr + error.message, durationMs: Date.now() - started, timedOut, aborted });
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ exitCode: code, stdout, stderr, durationMs: Date.now() - started, timedOut, aborted });
    });
  });
}

function fence(text) {
  return '```\n' + String(text).replace(/```/g, "'''").replace(/\n+$/, '') + '\n```';
}

function formatRunResult(command, result) {
  const stdout = redactSecrets(result.stdout).trim();
  const stderr = redactSecrets(result.stderr).trim();
  const ok = result.exitCode === 0 && !result.timedOut && !result.aborted;
  const status = result.timedOut ? 'timed out'
    : result.aborted ? 'cancelled'
      : `exit ${result.exitCode}`;

  let text = `${ok ? '✅' : '⚠️'} \`${redactSecrets(command).slice(0, 160)}\` — ${status} · ${result.durationMs} ms`;
  if (stdout) text += '\n' + fence(truncateOutput(stdout));
  if (stderr) text += `\n${stdout ? 'stderr:\n' : ''}` + fence(truncateOutput(stderr, 3000));
  if (!stdout && !stderr) text += '\n(no output)';
  if (result.timedOut) text += '\nThis ran longer than the limit. Say "run it in pm2" to run it in the background.';
  return text;
}

function aptPackageFor(tool) {
  return Object.prototype.hasOwnProperty.call(APT_PACKAGES, tool) ? APT_PACKAGES[tool] : undefined;
}

function isValidPackageName(name) {
  return /^[a-z0-9][a-z0-9+.-]{1,60}$/.test(String(name || ''));
}

function runFile(file, args, options = {}) {
  return new Promise(resolve => {
    execFile(file, args, { timeout: 300000, maxBuffer: 4 * 1024 * 1024, env: cleanEnv(options.env), cwd: options.cwd }, (error, stdout, stderr) => {
      resolve({ ok: !error, code: error ? error.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') + (error && !stderr ? error.message : '') });
    });
  });
}

async function installPackage(pkg) {
  if (!isValidPackageName(pkg)) return { ok: false, text: `"${pkg}" is not a valid package name.` };
  const env = { DEBIAN_FRONTEND: 'noninteractive' };
  let result = await runFile('sudo', ['-n', 'apt-get', 'install', '-y', pkg], { env });
  if (!result.ok && /Unable to locate package/i.test(result.stderr + result.stdout)) {
    await runFile('sudo', ['-n', 'apt-get', 'update'], { env });
    result = await runFile('sudo', ['-n', 'apt-get', 'install', '-y', pkg], { env });
  }
  if (result.ok) {
    existsCache.clear();
    return { ok: true, text: `✅ Installed \`${pkg}\`.` };
  }
  const combined = redactSecrets(result.stderr + '\n' + result.stdout);
  if (/password is required|a terminal is required|no tty present/i.test(combined)) {
    return { ok: false, text: `⚠️ sudo needs a password on this VPS, so I can't install \`${pkg}\` myself. Run this in your terminal:\n` + fence(`sudo apt-get install -y ${pkg}`) };
  }
  return { ok: false, text: `⚠️ Install of \`${pkg}\` failed.\n` + fence(truncateOutput(combined.trim(), 2500)) };
}

async function startPm2Job(command) {
  const name = 'sophie-job-' + crypto.randomBytes(2).toString('hex');
  const result = await runFile('pm2', [
    'start', SHELL, '--name', name, '--interpreter', 'none', '--no-autorestart', '--cwd', os.homedir(), '--', '-c', command
  ], { cwd: os.homedir() });
  if (!result.ok) {
    return { ok: false, name, text: '⚠️ Could not start the pm2 job.\n' + fence(truncateOutput(redactSecrets(result.stderr || result.stdout), 2000)) };
  }
  return {
    ok: true, name,
    text: `✅ Started in pm2 as \`${name}\`.\nSee output: \`run pm2 logs ${name} --nostream --lines 50\`\nRemove it when done: \`run pm2 delete ${name}\``
  };
}

module.exports = {
  KNOWN_TOOLS, APT_PACKAGES, MANUAL_INSTALL_HINT, DEFAULT_TIMEOUT_MS,
  parseExecRequest, splitSegments, referencedBinaries, commandExists, findMissingTools,
  runShell, formatRunResult, aptPackageFor, isValidPackageName, installPackage, startPm2Job, fence
};
