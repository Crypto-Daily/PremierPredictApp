const { askWithFallback } = require('../ai/providerRouter');
const { listProjectFiles, readProjectFile } = require('../core/selfInspect');
const { applyUpgrade } = require('../core/selfUpgrade');

const MAX_FILES = 8;
const MAX_CONTEXT = 80000;

const BLOCKED_PATHS = [
  '.env',
  'node_modules',
  '.git',
  'backups',
  'data',
  'logs',
  'workspace'
];

function isSafeSourcePath(filePath, allowedFiles = null) {
  if (typeof filePath !== 'string') return false;

  const normalized = filePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  if (!normalized.startsWith('src/')) return false;
  if (!normalized.endsWith('.js')) return false;

  if (BLOCKED_PATHS.some(part =>
    normalized === part ||
    normalized.startsWith(part + '/') ||
    normalized.includes('/' + part + '/')
  )) {
    return false;
  }

  if (allowedFiles && !allowedFiles.has(normalized)) return false;

  return true;
}

function parseJson(text) {
  let cleaned = String(text || '').trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const firstObject = cleaned.indexOf('{');
  const lastObject = cleaned.lastIndexOf('}');

  if (firstObject >= 0 && lastObject > firstObject) {
    try {
      return JSON.parse(cleaned.slice(firstObject, lastObject + 1));
    } catch {}
  }

  throw new Error('AI planner returned invalid JSON');
}

async function askPlanner(prompt) {
  const system = [
    'You are Sophie software architect.',
    'Return valid JSON only.',
    'Do not use Markdown fences.',
    'Never return shell commands.',
    'Only propose complete source files under src/.',
    'Never modify or access .env, credentials, node_modules, .git, backups, logs, data or workspace.',
    'Preserve all unrelated functionality exactly.',
    'Maximum 8 changed files.',
    'When asked to modify a file, return the COMPLETE FINAL CONTENT of that file.',
    'Do not return diffs, patches, snippets, explanations, or partial files.'
  ].join('\n');

  const result = await askWithFallback(
    prompt,
    system,
    { useWebSearch: false }
  );

  if (!result || typeof result.text !== 'string') {
    throw new Error('AI planner returned no text');
  }

  return parseJson(result.text);
}

async function inspectRequest(command) {
  const files = listProjectFiles()
    .filter(f => f.endsWith('.js'))
    .slice(0, 150);

  const result = await askPlanner(
    'User request:\n' +
    command +
    '\n\nAvailable source files:\n' +
    files.join('\n') +
    '\n\nReturn ONLY this JSON object:' +
    '\n{"files":["src/..."],"reason":"..."}' +
    '\nSelect at most 8 EXISTING files from the list.' +
    '\nIf the request names a specific file, select that file.'
  );

  const allowed = new Set(files);

  const selected = Array.isArray(result.files)
    ? result.files
        .filter(file => typeof file === 'string')
        .map(file => file.replace(/\\/g, '/').replace(/^\/+/, ''))
        .filter(file => allowed.has(file))
        .slice(0, MAX_FILES)
    : [];

  if (!selected.length) {
    throw new Error('No relevant source files were selected');
  }

  return {
    files: selected,
    reason: String(result.reason || '')
  };
}

function readContext(files) {
  let context = '';

  for (const filePath of files) {
    const file = readProjectFile(filePath);

    const block =
      '\n===== ' +
      file.path +
      ' =====\n' +
      file.content.slice(0, 16000);

    if (context.length + block.length > MAX_CONTEXT) break;

    context += block;
  }

  return context;
}

function normalizeChanges(rawChanges, allowedFiles) {
  if (!Array.isArray(rawChanges)) return [];

  return rawChanges
    .filter(change =>
      change &&
      typeof change === 'object' &&
      typeof change.path === 'string' &&
      typeof change.content === 'string'
    )
    .map(change => ({
      path: change.path
        .replace(/\\/g, '/')
        .replace(/^\/+/, ''),
      content: change.content
    }))
    .filter(change =>
      isSafeSourcePath(change.path, allowedFiles) &&
      change.content.length > 0
    )
    .slice(0, MAX_FILES);
}

async function planUpgrade(command) {
  if (
    typeof command !== 'string' ||
    !command.trim()
  ) {
    throw new Error('Upgrade request is required');
  }

  const request = command.trim();

  const inspection = await inspectRequest(request);
  const context = readContext(inspection.files);
  const allowedFiles = new Set(inspection.files);

  const result = await askPlanner(
    'User request:\n' +
    request +
    '\n\nRelevant current source files:\n' +
    context +
    '\n\nReturn ONLY valid JSON in this exact structure:' +
    '\n{"summary":"short description","changes":[{"path":"src/existing-file.js","content":"COMPLETE FINAL FILE CONTENT"}]}' +
    '\n\nRules:' +
    '\n1. Only include files from the provided relevant source files.' +
    '\n2. The path must be an existing src/*.js file.' +
    '\n3. Each content value must contain the COMPLETE FINAL FILE.' +
    '\n4. Do not return a diff or patch.' +
    '\n5. Do not modify unrelated functionality.' +
    '\n6. If only one file is needed, return exactly one change.' +
    '\n7. For a comment-only request, preserve the entire original file and make only that requested comment change.'
  );

  const changes = normalizeChanges(
    result.changes,
    allowedFiles
  );



  if (!changes.length) {
    const keys =
      result &&
      typeof result === 'object'
        ? Object.keys(result).join(', ')
        : 'none';

    throw new Error(
      'Planner produced no safe file changes. Planner response keys: ' +
      keys +
      '. Raw change count: ' +
      rawChanges.length
    );
  }

  return {
    request,
    summary: String(result.summary || ''),
    inspected: inspection.files,
    inspectionReason: inspection.reason,
    changes
  };
}

async function planAndApplyUpgrade(options) {
  const plan = await planUpgrade(options.command);

  const result = await applyUpgrade({
    changes: plan.changes,
    checkpoint: options.checkpoint !== false,
    restart: options.restart === true,
    checkpointMessage:
      options.checkpointMessage ||
      'Sophie AI self-upgrade'
  });

  return {
    ...result,
    request: plan.request,
    summary: plan.summary,
    inspected: plan.inspected,
    inspectionReason: plan.inspectionReason
  };
}

module.exports = {
  planUpgrade,
  planAndApplyUpgrade
};
