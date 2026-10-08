'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { cleanEnv, redactSecrets } = require('./sensitive');

const HOME = os.homedir();
const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', '.npm', '.pm2', '.nvm', '.local', '.config', '.ssh', 'snap', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next']);
const TOOLS = ['node', 'npm', 'pm2', 'git', 'python3', 'pip3', 'psql', 'redis-cli', 'sqlite3', 'docker', 'nginx', 'jq', 'curl', 'ffmpeg', 'soffice', 'pandoc', 'unzip', 'sudo'];

function run(file, args, options = {}) {
  return new Promise(resolve => {
    execFile(file, args, { timeout: options.timeout || 15000, maxBuffer: options.maxBuffer || 8 * 1024 * 1024, env: cleanEnv(), cwd: options.cwd }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function gb(bytes) { return (bytes / 1024 ** 3).toFixed(1) + ' GB'; }

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d ? d + 'd ' : ''}${h}h ${m}m`;
}

async function pm2Processes() {
  const res = await run('pm2', ['jlist'], { timeout: 15000 });
  if (!res.ok) return null;
  const start = res.stdout.indexOf('[');
  if (start < 0) return [];
  try {
    return JSON.parse(res.stdout.slice(start)).map(proc => ({
      name: proc.name,
      status: proc.pm2_env && proc.pm2_env.status,
      restarts: proc.pm2_env && proc.pm2_env.restart_time,
      uptimeMs: proc.pm2_env && proc.pm2_env.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : null,
      memoryMb: proc.monit ? Math.round(proc.monit.memory / 1048576) : null,
      cpu: proc.monit ? proc.monit.cpu : null,
      cwd: proc.pm2_env && proc.pm2_env.pm_cwd
    }));
  } catch { return null; }
}

async function toolAvailability() {
  const script = TOOLS.map(tool => `if command -v ${tool} >/dev/null 2>&1; then echo "${tool}:yes"; else echo "${tool}:no"; fi`).join('; ');
  const res = await run('/bin/bash', ['-lc', script], { timeout: 10000 });
  const found = [];
  const missing = [];
  for (const line of res.stdout.split('\n')) {
    const [name, flag] = line.trim().split(':');
    if (!name) continue;
    (flag === 'yes' ? found : missing).push(name);
  }
  return { found, missing };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

async function gitSummary(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) return null;
  const branch = await run('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']);
  const last = await run('git', ['-C', dir, 'log', '-3', '--pretty=%h %ad %s', '--date=short']);
  const dirty = await run('git', ['-C', dir, 'status', '--porcelain']);
  return {
    branch: branch.stdout.trim(),
    recent: last.stdout.trim().split('\n').filter(Boolean),
    changedFiles: dirty.stdout.trim() ? dirty.stdout.trim().split('\n').length : 0
  };
}

function projectKind(dir) {
  if (fs.existsSync(path.join(dir, 'package.json'))) return 'node';
  if (fs.existsSync(path.join(dir, 'requirements.txt')) || fs.existsSync(path.join(dir, 'pyproject.toml'))) return 'python';
  if (fs.existsSync(path.join(dir, '.git'))) return 'git';
  return null;
}

function listProjects(root = HOME) {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name))
    .map(entry => ({ name: entry.name, dir: path.join(root, entry.name) }))
    .map(item => ({ ...item, kind: projectKind(item.dir) }))
    .filter(item => item.kind);
}

async function serverOverview() {
  const [pm2, tools, disk, ports] = await Promise.all([
    pm2Processes(),
    toolAvailability(),
    run('df', ['-hP', '/']),
    run('ss', ['-tln'])
  ]);

  const lines = ['## Server overview'];
  lines.push(`Host: ${os.hostname()} · ${os.type()} ${os.release()} · ${os.cpus().length} CPU · up ${formatUptime(os.uptime())}`);
  lines.push(`Load: ${os.loadavg().map(n => n.toFixed(2)).join(' / ')} · RAM: ${gb(os.totalmem() - os.freemem())} used of ${gb(os.totalmem())}`);
  const diskLine = disk.stdout.trim().split('\n')[1];
  if (diskLine) {
    const cols = diskLine.split(/\s+/);
    lines.push(`Disk (/): ${cols[2]} used of ${cols[1]} (${cols[4]})`);
  }

  lines.push('', '### PM2 processes');
  if (pm2 === null) lines.push('PM2 not available or not responding.');
  else if (!pm2.length) lines.push('No PM2 processes.');
  else {
    for (const proc of pm2) {
      lines.push(`- ${proc.name}: ${proc.status}${proc.uptimeMs != null ? ' · up ' + formatUptime(proc.uptimeMs / 1000) : ''} · ${proc.restarts} restarts · ${proc.memoryMb ?? '?'} MB · ${proc.cpu ?? '?'}% CPU`);
    }
  }

  const projects = listProjects();
  lines.push('', '### Projects in your home folder');
  if (!projects.length) lines.push('None found.');
  for (const project of projects.slice(0, 25)) {
    const pkg = project.kind === 'node' ? readJson(path.join(project.dir, 'package.json')) : null;
    const git = await gitSummary(project.dir);
    const proc = pm2 && pm2.find(item => item.cwd && path.resolve(item.cwd) === path.resolve(project.dir));
    lines.push(`- ${project.name} (${project.kind}${pkg && pkg.version ? ' v' + pkg.version : ''})` +
      (proc ? ` · pm2: ${proc.name} ${proc.status}` : '') +
      (git ? ` · git ${git.branch}${git.changedFiles ? `, ${git.changedFiles} uncommitted` : ''}` : ''));
  }

  const listening = ports.stdout.trim().split('\n').slice(1).map(line => line.trim().split(/\s+/)[3]).filter(Boolean);
  if (listening.length) lines.push('', '### Listening TCP ports', [...new Set(listening)].join(', '));

  lines.push('', '### Tools', `Installed: ${tools.found.join(', ') || 'none'}`, `Missing: ${tools.missing.join(', ') || 'none'}`);
  lines.push('', 'Ask "inspect project <name>" for details on one project. Secret files (.env, keys) are never shown.');
  return lines.join('\n');
}

function normalize(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function findProject(query) {
  const needle = normalize(query);
  if (!needle) return null;
  const projects = listProjects();
  return projects.find(item => normalize(item.name) === needle)
    || projects.find(item => normalize(item.name).includes(needle) || needle.includes(normalize(item.name)))
    || null;
}

function tree(dir, depth = 2, prefix = '', budget = { left: 60 }) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  entries = entries
    .filter(entry => !SKIP_DIRS.has(entry.name) && !(entry.name.startsWith('.') && entry.name !== '.github'))
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  const lines = [];
  for (const entry of entries) {
    if (budget.left-- <= 0) { lines.push(prefix + '…'); break; }
    lines.push(prefix + entry.name + (entry.isDirectory() ? '/' : ''));
    if (entry.isDirectory() && depth > 1) lines.push(...tree(path.join(dir, entry.name), depth - 1, prefix + '  ', budget));
  }
  return lines;
}

async function projectOverview(query) {
  const project = findProject(query);
  if (!project) {
    const names = listProjects().map(item => item.name).join(', ') || 'none found';
    return `I couldn't find a project matching "${query}". Projects I can see: ${names}.`;
  }

  const lines = [`## Project: ${project.name}`, `Path: ${project.dir} (${project.kind})`];
  const pkg = readJson(path.join(project.dir, 'package.json'));
  if (pkg) {
    lines.push(`Package: ${pkg.name || '?'} ${pkg.version || ''}${pkg.main ? ' · main: ' + pkg.main : ''}`);
    if (pkg.scripts) lines.push('Scripts: ' + Object.keys(pkg.scripts).slice(0, 15).join(', '));
    const deps = Object.keys(pkg.dependencies || {});
    if (deps.length) lines.push(`Dependencies (${deps.length}): ${deps.slice(0, 30).join(', ')}`);
  }

  const git = await gitSummary(project.dir);
  if (git) {
    lines.push(`Git: ${git.branch}${git.changedFiles ? `, ${git.changedFiles} uncommitted file(s)` : ', clean'}`);
    lines.push(...git.recent.map(item => '  ' + redactSecrets(item)));
  }

  const pm2 = await pm2Processes();
  const proc = pm2 && pm2.find(item => item.cwd && path.resolve(item.cwd) === path.resolve(project.dir));
  if (proc) lines.push(`PM2: ${proc.name} · ${proc.status} · ${proc.restarts} restarts · ${proc.memoryMb ?? '?'} MB`);

  const hasEnv = fs.readdirSync(project.dir).some(name => /^\.env(\.|$)/.test(name));
  if (hasEnv) lines.push('Config: a .env file exists (contents hidden for safety).');

  lines.push('', 'Structure:', ...tree(project.dir).map(item => '  ' + item));

  for (const readme of ['README.md', 'readme.md', 'README']) {
    const file = path.join(project.dir, readme);
    if (fs.existsSync(file)) {
      const head = redactSecrets(fs.readFileSync(file, 'utf8').split('\n').slice(0, 14).join('\n'));
      lines.push('', `${readme} (first lines):`, head);
      break;
    }
  }
  lines.push('', `To read a file: "read file ${project.dir}/<file>"`);
  return lines.join('\n');
}

module.exports = { serverOverview, projectOverview, listProjects, findProject, pm2Processes };
