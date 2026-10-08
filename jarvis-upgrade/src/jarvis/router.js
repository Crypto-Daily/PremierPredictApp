'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pending = require('./pending');
const exec = require('./execRunner');
const plugins = require('./pluginManager');
const builder = require('./pluginBuilder');
const { findBlockedReason, classifyRisk, redactSecrets } = require('./sensitive');

const LOCKED = '🔒 Command execution and plugin changes are locked. Tap **🔓 Admin** next to the message box and enter your passcode (never type it in chat), then ask again.';
const CODE_EXT = new Set(['js', 'mjs', 'cjs', 'json', 'md', 'txt', 'py', 'html', 'css', 'ts', 'tsx', 'jsx', 'yml', 'yaml', 'log', 'sh', 'env', 'conf', 'lock', 'toml', 'ini', 'csv', 'xml', 'sql', 'pdf', 'png', 'jpg']);
const JARVIS_HELP = [
  'Jarvis tools (unlock Admin first for anything that runs or changes things)',
  '',
  'SERVER COMMANDS (Admin)',
  '- run node -v · run pm2 list · $ ls -la ~ · run psql -c "select 1"',
  '- Missing tool? I say "Tool not available" and offer to install it or run in the background: "install it", "run it in pm2".',
  '- Risky commands (rm -rf, sudo, pm2 stop/delete...) need "confirm <code>". Secrets (.env, keys) are never shown.',
  '',
  'INSPECT',
  '- inspect website https://example.com (TLS, headers, SEO, broken links, performance)',
  '- inspect server · inspect project bybit ai bot · read file /path',
  '',
  'DOCUMENTS AND MEDIA',
  '- Ask for HTML, PDF, DOCX, images in normal chat; results appear inline and in Artifacts.',
  '- The Screen and Video buttons (Jarvis mode) let me look at your screen or a video file.',
  '',
  'PLUGINS',
  '- list plugins · reload plugins · create a plugin that <what you need> (I draft it, you approve it)'
].join('\n');

const MIME = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.html': 'text/html', '.md': 'text/markdown', '.txt': 'text/plain',
  '.csv': 'text/csv', '.json': 'application/json'
};

function workspace() {
  return require('../core/artifactManager');
}

function mimeFor(file) {
  return MIME[path.extname(String(file)).toLowerCase()] || 'application/octet-stream';
}

function pluginContext(opts) {
  const am = workspace();
  const { guardedRequest } = require('./netGuard');
  return {
    workspaceRoot: am.WORKSPACE_ROOT,
    resolveArtifact: am.resolveArtifact,
    fetchPublic: (url, options = {}) => guardedRequest(url, { ...options, allowPrivate: false }),
    runCommand: async command => {
      if (!opts.upgradeAuthorized) throw new Error('Admin is locked.');
      const reason = findBlockedReason(command);
      if (reason) throw new Error(`Blocked: that would expose ${reason}.`);
      return exec.runShell(command, { signal: opts.signal });
    },
    redact: redactSecrets,
    mimeFor,
    admin: Boolean(opts.upgradeAuthorized)
  };
}

function reply(text, artifacts) {
  return { handled: true, text, artifacts: artifacts || [] };
}

async function toolMissingReply(missing, originalCommand, opts) {
  const tool = missing[0];
  const aptPkg = exec.aptPackageFor(tool);
  const others = missing.length > 1 ? `\n(Also missing: ${missing.slice(1).map(item => '`' + item + '`').join(', ')}.)` : '';

  if (aptPkg) {
    const id = pending.create('install', { tool, pkg: aptPkg, command: originalCommand });
    return reply(
      `🔧 **Tool not available:** \`${tool}\` is not installed on this server.${others}\n` +
      `I can install it with \`sudo apt-get install -y ${aptPkg}\`.\n` +
      `• Reply **install it** (or \`confirm ${id}\`) and I'll install it, then re-run your command.\n` +
      `• Or say **run it in pm2** if you'd rather run something in the background instead.`
    );
  }
  const hint = exec.MANUAL_INSTALL_HINT[tool];
  return reply(
    `🔧 **Tool not available:** \`${tool}\` is not installed on this server.${others}\n` +
    (hint ? hint + '\n' : "I don't know the apt package for it. ") +
    'If you know the apt package name, say `install package <name>`.'
  );
}

async function runExec(commandText, opts, { skipChecks = false } = {}) {
  if (!opts.upgradeAuthorized) return reply(LOCKED);

  const command = String(commandText || '').trim();
  if (!command) return reply('Tell me what to run, e.g. `run node -v`.');
  if (command.length > 2000) return reply('That command is too long (limit 2,000 characters).');

  const blocked = findBlockedReason(command);
  if (blocked) {
    return reply(`⛔ I won't run that: it would expose ${blocked}. If you really need it, run it yourself in your terminal.`);
  }

  pending.setLastCommand(command);

  if (!skipChecks) {
    const missing = await exec.findMissingTools(command);
    if (missing.length) return toolMissingReply(missing, command, opts);

    const risk = classifyRisk(command);
    if (risk.dangerous) {
      const id = pending.create('command', { command });
      return reply(`⚠️ \`${command.slice(0, 200)}\` ${risk.reasons.join('; ')}.\nReply \`confirm ${id}\` to run it, or \`cancel\`.`);
    }
  }

  const result = await exec.runShell(command, { signal: opts.signal });
  return reply(exec.formatRunResult(command, result));
}

async function runInPm2(commandText, opts) {
  if (!opts.upgradeAuthorized) return reply(LOCKED);
  const command = String(commandText || pending.getLastCommand() || '').trim();
  if (!command) return reply('I have no previous command to run. Say `run <command> in pm2`.');

  const blocked = findBlockedReason(command);
  if (blocked) return reply(`⛔ I won't run that: it would expose ${blocked}.`);

  const missing = await exec.findMissingTools(command);
  if (missing.length) return toolMissingReply(missing, command, opts);

  const risk = classifyRisk(command);
  if (risk.dangerous) {
    const id = pending.create('pm2', { command });
    return reply(`⚠️ \`${command.slice(0, 200)}\` ${risk.reasons.join('; ')}.\nReply \`confirm ${id}\` to start it in pm2, or \`cancel\`.`);
  }
  const job = await exec.startPm2Job(command);
  return reply(job.text);
}

async function runPending(item, opts) {
  if (!opts.upgradeAuthorized) return reply(LOCKED);
  const payload = item.payload;

  if (item.type === 'command') return runExec(payload.command, opts, { skipChecks: true });
  if (item.type === 'pm2') return reply((await exec.startPm2Job(payload.command)).text);

  if (item.type === 'install') {
    const installed = await exec.installPackage(payload.pkg);
    if (!installed.ok || !payload.command) return reply(installed.text);
    const rerun = await runExec(payload.command, opts);
    return reply(installed.text + '\n\n' + rerun.text, rerun.artifacts);
  }

  if (item.type === 'plugin') {
    const result = await builder.installPlugin(payload.draft);
    if (!result || result.ok === false || result.success === false) {
      return reply('⚠️ The plugin was not installed: ' + String((result && (result.error || result.message)) || 'validation failed').slice(0, 300));
    }
    const status = plugins.load();
    const loaded = status.loaded.includes(payload.draft.name);
    const failure = status.errors.find(entry => entry.file === `${payload.draft.name}.js`);
    return reply(loaded
      ? `✅ Plugin **${payload.draft.name}** is installed and live (no restart needed). Say "list plugins" to see it.`
      : `⚠️ The file was written but the plugin did not load${failure ? ': ' + failure.error : ''}. Ask me to fix it, or remove src/plugins/${payload.draft.name}.js.`);
  }
  return reply('That request is no longer valid.');
}

function saveReport(host, report) {
  const am = workspace();
  const dir = path.join(am.WORKSPACE_ROOT, 'inspections');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${host.replace(/[^a-z0-9.-]/gi, '_')}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
  const file = path.join(dir, name);
  fs.writeFileSync(file, report, 'utf8');
  const stat = fs.statSync(file);
  return { path: 'inspections/' + name, size: stat.size, modifiedAt: stat.mtime.toISOString(), mimeType: 'text/markdown' };
}

function extractSiteTarget(text) {
  const m = /^(?:please\s+|can you\s+|could you\s+)?(?:inspect|debug|audit|check|analy[sz]e|scan|test|diagnose)\s+(?:the\s+|this\s+|my\s+)?(website|web\s*site|site|web\s*page|page|url|web\s*app|app)?\s*:?\s*(https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s]*)?)(?:\s+(?:and|then|for|please).*)?[.!?]*$/i.exec(text);
  if (!m) return null;
  const target = m[2].replace(/[),.;!?]+$/, '');
  if (!/^https?:\/\//i.test(target)) {
    const ext = target.split('/')[0].split('.').pop().toLowerCase();
    if (CODE_EXT.has(ext) && !m[1]) return null;
    if (/^(?:the|my|your|this)$/i.test(target)) return null;
  }
  return target;
}

async function handleJarvis(command, opts = {}) {
  const text = String(command || '').trim();
  if (!text || text.length > 4000) return null;
  let m;

  if (/^(?:help\s+(?:with\s+)?(?:jarvis|shell|server|tools|plugins)|jarvis\s+(?:help|commands)|what can (?:you|jarvis) run)\??[.! ]*$/i.test(text)) return reply(JARVIS_HELP);

  // --- confirmations -------------------------------------------------------
  if ((m = /^(?:confirm|approve)\s+([0-9a-f]{4})\b/i.exec(text))) {
    const item = pending.take(m[1]);
    return item ? runPending(item, opts) : reply('That confirmation code has expired or is not valid.');
  }
  if (/^(?:cancel|abort|never\s*mind|nevermind|no|nope|stop that)[.! ]*$/i.test(text) && pending.latest()) {
    const item = pending.latest();
    pending.take(item.id);
    return reply('Cancelled.');
  }
  if (/^(?:yes|y|yep|yeah|ok|okay|sure|go ahead|do it|please do)[.! ]*$|^(?:yes[, ]+)?(?:please\s+)?install(?:\s+(?:it|that|this|them))?[.! ]*$/i.test(text)) {
    const item = pending.latest('install');
    if (item) { pending.take(item.id); return runPending(item, opts); }
    return null;
  }
  if ((m = /^(?:please\s+)?install\s+(?:the\s+)?(?:package\s+)?([a-z0-9][a-z0-9+.-]{1,60})[.! ]*$/i.exec(text))) {
    const name = m[1].toLowerCase();
    const pkg = exec.aptPackageFor(name) || (exec.isValidPackageName(name) && !exec.KNOWN_TOOLS.has(name) ? name : null);
    if (!pkg) return reply(exec.MANUAL_INSTALL_HINT[name] || `I'm not sure which apt package provides \`${name}\`. Say \`install package <name>\` with the exact package.`);
    if (!opts.upgradeAuthorized) return reply(LOCKED);
    const id = pending.create('install', { tool: name, pkg, command: null });
    return reply(`🔧 I'll run \`sudo apt-get install -y ${pkg}\`. Reply **install it** (or \`confirm ${id}\`) to go ahead, or \`cancel\`.`);
  }

  // --- plugins -------------------------------------------------------------
  if (/^(?:list|show|what)\s+(?:the\s+|my\s+|installed\s+|available\s+)*(?:plugins?|connectors?|extensions?)\b/i.test(text)) {
    return reply(plugins.describeAll());
  }
  if (/^reload\s+(?:the\s+)?plugins?\b/i.test(text)) {
    if (!opts.upgradeAuthorized) return reply(LOCKED);
    const status = plugins.load();
    return reply(`Reloaded plugins: ${status.loaded.join(', ') || 'none'}${status.errors.length ? `\n⚠️ ${status.errors.map(item => `${item.file}: ${item.error}`).join('\n')}` : ''}`);
  }
  if ((m = /^(?:please\s+)?(?:create|add|build|make|write|draft)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:sophie\s+)?(?:plugin|connector|extension)\b\s*(?:for|that|to|which|so that|:)?\s*(.*)$/i.exec(text))) {
    if (!opts.upgradeAuthorized) return reply(LOCKED);
    const request = m[1].trim();
    if (request.length < 8) return reply('What should the plugin do? For example: "create a plugin that checks my site uptime every time I say ping site".');
    try {
      const draft = await builder.draftPlugin(request);
      const am = workspace();
      const draftDir = path.join(am.WORKSPACE_ROOT, 'plugin-drafts');
      fs.mkdirSync(draftDir, { recursive: true });
      const draftFile = path.join(draftDir, draft.name + '.js');
      fs.writeFileSync(draftFile, draft.code, 'utf8');
      const stat = fs.statSync(draftFile);
      const id = pending.create('plugin', { draft });
      return reply(
        `🧩 Drafted plugin **${draft.name}** — ${draft.summary || 'no summary'}\n` +
        `It would be saved as \`${draft.file}\` and loaded immediately.\n` +
        `Capabilities detected: ${draft.flags.length ? draft.flags.join('; ') : 'none of the risky ones'}.\n` +
        'Read the code in the Artifacts panel (plugin-drafts/' + draft.name + '.js).\n' +
        `Reply \`approve ${id}\` to install it, or \`cancel\`.`,
        [{ path: 'plugin-drafts/' + draft.name + '.js', size: stat.size, modifiedAt: stat.mtime.toISOString(), mimeType: 'text/plain' }]
      );
    } catch (error) {
      return reply('⚠️ I could not draft that plugin: ' + redactSecrets(error.message).slice(0, 300));
    }
  }

  // --- inspectors ----------------------------------------------------------
  const siteTarget = extractSiteTarget(text);
  if (siteTarget) {
    const { inspectSite } = require('./siteInspector');
    const result = await inspectSite(siteTarget, { allowPrivate: Boolean(opts.upgradeAuthorized) });
    let host = 'site';
    try { host = new URL(/^https?:/i.test(siteTarget) ? siteTarget : 'https://' + siteTarget).hostname; } catch { /* keep default */ }
    const artifact = saveReport(host, result.report);
    const shown = result.report.length > 5500 ? result.report.slice(0, 5500) + '\n…\n(Full report saved in the Artifacts panel.)' : result.report;
    return reply(shown, [artifact]);
  }

  if (/^(?:please\s+)?(?:inspect|scan|audit|check|show|give me|overview of|status of|analy[sz]e)\s+(?:the\s+|my\s+|this\s+|entire\s+|whole\s+|full\s+|complete\s+)*(?:ubuntu\s+|linux\s+)?(?:server|vps|machine|system|box)(?:\s+(?:status|health|overview))?\s*[.!?]*$/i.test(text)
    || /^(?:server|vps|system)\s+(?:status|health|overview)\s*[.!?]*$/i.test(text)
    || /^(?:what|which)\s+tools\s+(?:are\s+)?(?:installed|available)\b/i.test(text)
    || /^(?:list|show)\s+(?:my\s+|all\s+)?projects\s*[.!?]*$/i.test(text)) {
    return reply(await require('./serverInspect').serverOverview());
  }

  if (!/\byour\b/i.test(text)) {
    if ((m = /^(?:please\s+)?(?:inspect|overview of|summari[sz]e|read|show me|tell me about|look at|analy[sz]e|open)\s+(?:the\s+)?(?:project|repo|repository|codebase)\s+(.+?)[.!?]*$/i.exec(text))) {
      return reply(await require('./serverInspect').projectOverview(m[1]));
    }
    if ((m = /^(?:please\s+)?(?:inspect|overview of|summari[sz]e|tell me about|look at|analy[sz]e)\s+(?:the\s+)?(.+?)\s+(?:project|repo|repository|codebase)[.!?]*$/i.exec(text))) {
      const serverInspect = require('./serverInspect');
      if (serverInspect.findProject(m[1])) return reply(await serverInspect.projectOverview(m[1]));
    }
  }

  // --- shell ---------------------------------------------------------------
  if ((m = /^(?:please\s+)?run\s+(?:it|that|this|the last command)\s+(?:in|with|under|via)\s+(?:the\s+)?pm2[.! ]*$/i.exec(text))) return runInPm2(null, opts);
  if ((m = /^(?:please\s+)?run\s+(.+?)\s+(?:in|with|under|via)\s+(?:the\s+)?pm2[.! ]*$/i.exec(text))) {
    const first = m[1].trim().split(/\s+/)[0];
    if (exec.KNOWN_TOOLS.has(first) || /^(?:\.\/|\/|~\/)/.test(first)) return runInPm2(m[1].replace(/^`+|`+$/g, ''), opts);
  }

  const parsed = exec.parseExecRequest(text);
  if (parsed) return runExec(parsed.command, opts);

  // --- plugin triggers -----------------------------------------------------
  const hit = plugins.match(text);
  if (hit) {
    const { plugin } = hit;
    if (plugin.risk === 'high' && !opts.upgradeAuthorized) return reply(LOCKED);
    const missing = [];
    for (const bin of plugin.requires) if (!(await exec.commandExists(bin))) missing.push(bin);
    if (missing.length) return toolMissingReply(missing, null, opts);
    try {
      const result = await plugins.runPlugin(plugin, { command: text, match: hit.match, ctx: pluginContext(opts) });
      return reply(redactSecrets(String((result && result.text) || 'Done.')), (result && result.artifacts) || []);
    } catch (error) {
      return reply(`⚠️ Plugin **${plugin.name}** failed: ${redactSecrets(error.message).slice(0, 300)}`);
    }
  }

  return null;
}

module.exports = { handleJarvis, extractSiteTarget, LOCKED, mimeFor };
