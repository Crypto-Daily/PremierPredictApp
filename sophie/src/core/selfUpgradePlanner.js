const { askWithFallback } = require('../ai/providerRouter');
const { listProjectFiles, readProjectFile } = require('../core/selfInspect');
const { applyUpgrade } = require('../core/selfUpgrade');

const MAX_FILES = 8;
const MAX_CONTEXT = 80000;

function parseJson(text) {
  const cleaned = String(text || '').replace(/^\`\`\`json/i, '').replace(/^\`\`\`/i, '').replace(/\`\`\`$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(cleaned.slice(a, b + 1));
  throw new Error('AI planner returned invalid JSON');
}

async function askPlanner(prompt) {
  const system = [
    'You are Sophie software architect.',
    'Return JSON only. Never return shell commands.',
    'Only propose complete source files under src/.',
    'Never access secrets, .env, credentials, node_modules, .git, backups, logs, data or workspace.',
    'Preserve unrelated functionality.',
    'Maximum 8 changed files.'
  ].join('\n');

  const result = await askWithFallback(prompt, system, { useWebSearch: false });
  return parseJson(result.text);
}

async function inspectRequest(command) {
  const files = listProjectFiles().filter(f => f.endsWith('.js')).slice(0, 150);
  const result = await askPlanner(
    'User request:\n' + command +
    '\n\nAvailable source files:\n' + files.join('\n') +
    '\n\nReturn JSON: {"files":["src/..."],"reason":"..."}.' +
    ' Select at most 8 existing files from the list.'
  );

  const allowed = new Set(files);
  const selected = Array.isArray(result.files)
    ? result.files.filter(f => allowed.has(f)).slice(0, MAX_FILES)
    : [];

  if (!selected.length) throw new Error('No relevant source files were selected');
  return { files: selected, reason: String(result.reason || '') };
}

function readContext(files) {
  let context = '';
  for (const filePath of files) {
    const file = readProjectFile(filePath);
    const block = '\n===== ' + file.path + ' =====\n' + file.content.slice(0, 16000);
    if (context.length + block.length > MAX_CONTEXT) break;
    context += block;
  }
  return context;
}

async function planUpgrade(command) {
  if (typeof command !== 'string' || !command.trim()) throw new Error('Upgrade request is required');

  const inspection = await inspectRequest(command.trim());
  const context = readContext(inspection.files);

  const result = await askPlanner(
    'User request:\n' + command +
    '\n\nRelevant current source:\n' + context +
    '\n\nReturn JSON exactly as:' +
    '{"summary":"...","changes":[{"path":"src/...","content":"COMPLETE FILE CONTENT"}]}' +
    '\nEvery content value must be the complete final file, not a diff.' +
    '\nOnly change files needed for the request.'
  );

  const changes = Array.isArray(result.changes)
    ? result.changes.filter(c => c && typeof c.path === 'string' && typeof c.content === 'string').slice(0, MAX_FILES)
    : [];

  if (!changes.length) throw new Error('Planner produced no safe file changes');

  return {
    request: command.trim(),
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
    checkpointMessage: options.checkpointMessage || 'Sophie AI self-upgrade'
  });

  return {
    ...result,
    request: plan.request,
    summary: plan.summary,
    inspected: plan.inspected,
    inspectionReason: plan.inspectionReason
  };
}

module.exports = { planUpgrade, planAndApplyUpgrade };
