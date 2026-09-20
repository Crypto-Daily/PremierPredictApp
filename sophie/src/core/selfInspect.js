const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SOPHIE_SRC_ROOT = path.join(PROJECT_ROOT, 'src');

// Full filesystem root for listDirectory/readAnyFile. Read-only, and the
// OS's own permissions already block most system-owned files (root-only
// dirs like /root, /etc/shadow) for the 'ubuntu' user — these patterns are
// an extra layer on top of that, not the only layer.
const ROOT = '/';

const BLOCKED_PATTERNS = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /id_rsa/i,
  /\.pem$/i,
  /credentials/i,
  /(^|\/)\.aws(\/|$)/i,
  /(^|\/)\.docker(\/|$)/i,
  /(^|\/)\.config\/gcloud(\/|$)/i,
  /^\/etc\/shadow$/,
  /^\/etc\/gshadow$/,
  /^\/etc\/ssh(\/|$)/,
  /^\/root(\/|$)/,
  /^\/proc(\/|$)/,
  /^\/sys(\/|$)/
];

const IGNORE_LIST_PATTERNS = [
  /\.backup$/,
  /\.before-/,
  /node_modules/,
  /\.git(\/|$)/
];

function isBlocked(resolvedPath) {
  return BLOCKED_PATTERNS.some(pattern => pattern.test(resolvedPath));
}

function isIgnoredForListing(name) {
  return IGNORE_LIST_PATTERNS.some(pattern => pattern.test(name));
}

// --- Sophie's own architecture (unchanged — self-inspection questions) ---

function listProjectFiles(dir = SOPHIE_SRC_ROOT, base = SOPHIE_SRC_ROOT) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];

  for (const entry of entries) {
    if (isIgnoredForListing(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files = files.concat(listProjectFiles(fullPath, base));
    } else {
      files.push(path.relative(PROJECT_ROOT, fullPath));
    }
  }

  return files;
}

function readProjectFile(relativePath) {
  const resolved = path.resolve(PROJECT_ROOT, relativePath);

  if (!resolved.startsWith(SOPHIE_SRC_ROOT)) {
    throw new Error('Access denied: path is outside src/');
  }

  return readFileSafely(resolved, relativePath);
}

// --- Full-server read access (root-scoped, read-only) ---

function listDirectory(relativeOrAbsolutePath) {
  const resolved = path.resolve(ROOT, relativeOrAbsolutePath);

  if (isBlocked(resolved)) {
    throw new Error('Access denied: this path is blocked for safety');
  }

  let entries;

  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Could not list ${resolved}: ${error.message}`);
  }

  return entries
    .filter(e => !isIgnoredForListing(e.name))
    .map(e => (e.isDirectory() ? `${e.name}/` : e.name));
}

function readAnyFile(relativeOrAbsolutePath) {
  const resolved = path.resolve(ROOT, relativeOrAbsolutePath);

  if (isBlocked(resolved)) {
    throw new Error('Access denied: this file is blocked for safety — read it directly via terminal instead');
  }

  return readFileSafely(resolved, resolved);
}

function readFileSafely(resolved, displayPath) {
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${displayPath}`);
  }

  const stat = fs.statSync(resolved);

  if (stat.isDirectory()) {
    throw new Error(`${displayPath} is a directory, not a file — use listDirectory instead`);
  }

  const content = fs.readFileSync(resolved, 'utf8');
  const MAX_CHARS = 6000;

  if (content.length > MAX_CHARS) {
    return {
      path: displayPath,
      content: content.slice(0, MAX_CHARS),
      truncated: true,
      totalLength: content.length
    };
  }

  return { path: displayPath, content, truncated: false, totalLength: content.length };
}

const MODULE_MAP = {
  memory: 'src/memory/memory.js',
  vision: 'src/ai/vision.js',
  'provider router': 'src/ai/providerRouter.js',
  fallback: 'src/ai/providerRouter.js',
  gemini: 'src/ai/gemini.js',
  prompt: 'src/ai/prompt.js',
  'intent router': 'src/ai/intentRouter.js',
  routing: 'src/ai/intentRouter.js',
  time: 'src/core/time.js',
  identity: 'src/core/identity.js',
  'module manager': 'src/core/moduleManager.js',
  'command processor': 'src/commands/commandProcessor.js',
  research: 'src/research/webSearch.js',
  wikipedia: 'src/research/wikipedia.js',
  wikidata: 'src/research/wikidata.js',
  gdelt: 'src/research/gdelt.js',
  sportsdb: 'src/research/sportsdb.js',
  server: 'src/server/server.js',
  'self inspection': 'src/core/selfInspect.js'
};

function findByName(query) {
  const needle = String(query || '').trim().toLowerCase();

  if (!needle) return [];

  const matches = [];

  function walk(dir) {
    let entries;

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (isIgnoredForListing(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(PROJECT_ROOT, fullPath);

      if (entry.name.toLowerCase().includes(needle)) {
        matches.push({
          path: relativePath,
          type: entry.isDirectory() ? 'directory' : 'file'
        });
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      }
    }
  }

  walk(SOPHIE_SRC_ROOT);

  return matches.slice(0, 100);
}

function resolveModuleQuery(query) {
  const text = query.toLowerCase();

  for (const [keyword, filePath] of Object.entries(MODULE_MAP)) {
    if (text.includes(keyword)) {
      return filePath;
    }
  }

  return null;
}

module.exports = {
  listProjectFiles,
  readProjectFile,
  resolveModuleQuery,
  listDirectory,
  readAnyFile,
  findByName
};
