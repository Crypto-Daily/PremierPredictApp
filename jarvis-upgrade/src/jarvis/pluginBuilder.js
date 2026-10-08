'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const SPEC = [
  'A Sophie plugin is ONE CommonJS file that exports an object:',
  "  name (lowercase letters/numbers/dashes), description (one sentence), version ('1.0.0'),",
  '  requires (array of binary names it needs, may be empty),',
  "  risk ('low' for harmless/read-only, 'high' for anything that writes, deletes or executes),",
  '  triggers (non-empty array of RegExp matched against the user message),',
  '  async run({ command, match, ctx }) returning { text, artifacts? }.',
  'ctx offers: workspaceRoot, resolveArtifact(rel), fetchPublic(url, opts), runCommand(cmd) (admin only),',
  '  redact(text), mimeFor(file), admin (boolean).',
  'Rules: use only Node built-ins (no npm packages). Never read .env files or credentials.',
  'Never hardcode secrets. Keep it small and readable. Start the file with \'use strict\';'
].join('\n');

function parseJson(text) {
  let cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { /* try slice */ }
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
  throw new Error('The AI did not return valid JSON.');
}

function staticFlags(code) {
  const flags = [];
  const check = (pattern, label) => { if (pattern.test(code)) flags.push(label); };
  check(/child_process|\bexecFile?\b|\bspawn\b|ctx\.runCommand/, 'runs shell commands');
  check(/writeFile|appendFile|createWriteStream|\bunlink|\brmSync|\brm\(|rmdir|mkdirSync|renameSync|copyFile/, 'writes/deletes files');
  check(/require\(['"](?:node:)?(?:https?|net|tls|dgram)['"]\)|\bfetch\(|ctx\.fetchPublic/, 'makes network requests');
  check(/process\.env/, 'reads environment variables');
  check(/\beval\(|new Function\(/, 'uses eval/new Function');
  check(/\.env\b|id_rsa|\.ssh|credentials/i, 'mentions secret files');
  check(/require\(\s*[^'"\s]/, 'uses a dynamic require');
  return flags;
}

function syntaxCheck(code) {
  const file = path.join(os.tmpdir(), `sophie-plugin-${crypto.randomBytes(4).toString('hex')}.js`);
  try {
    fs.writeFileSync(file, code, 'utf8');
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe', timeout: 15000 });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error.stderr || error.message).slice(0, 400) };
  } finally {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }
}

async function draftPlugin(request, ask) {
  const askFn = ask || require('../ai/providerRouter').askWithFallback;
  const result = await askFn(
    `Write a Sophie plugin for this request:\n${request}\n\nReturn ONLY JSON: {"name":"slug","summary":"what it does","code":"COMPLETE FILE CONTENT"}`,
    'You are a careful Node.js engineer writing small plugins for Sophie.\n' + SPEC + '\nReturn valid JSON only, no Markdown fences.',
    { useWebSearch: false }
  );

  const parsed = parseJson(result && result.text);
  const name = String(parsed.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const code = String(parsed.code || '');

  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(name)) throw new Error('The draft had no usable plugin name.');
  if (!/module\.exports/.test(code)) throw new Error('The draft is missing module.exports.');
  if (code.length > 30000) throw new Error('The draft is too large (limit 30,000 characters).');

  const syntax = syntaxCheck(code);
  if (!syntax.ok) throw new Error('The draft has a syntax error: ' + syntax.error);

  return { name, file: `src/plugins/${name}.js`, summary: String(parsed.summary || '').slice(0, 300), code, flags: staticFlags(code) };
}

async function installPlugin(draft, applyUpgrade) {
  const apply = applyUpgrade || require('../core/selfUpgrade').applyUpgrade;
  return apply({ changes: [{ path: draft.file, content: draft.code }], checkpoint: false, restart: false });
}

module.exports = { draftPlugin, installPlugin, staticFlags, syntaxCheck, parseJson };
