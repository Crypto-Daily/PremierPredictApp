'use strict';

const { shouldDelegateToHermes } = require('./agentPolicy');
const { getTool } = require('../tools');
const { snapshot, diff, WORKSPACE_ROOT } = require('../core/artifactManager');
const fs = require('node:fs');
const path = require('node:path');

function buildHermesTask({ command, mode, intent, memoryFacts = [], conversation = [] }) {
  const memoryText = memoryFacts.length
    ? memoryFacts.map(f => '- ' + f.fact).join('\n')
    : 'No stored long-term facts.';

  const conversationText = conversation.length
    ? conversation.slice(-12).map(m => (m.role === 'assistant' ? 'Sophie: ' : 'User: ') + m.text).join('\n')
    : 'No recent conversation context.';

  return [
    'You are Hermes, the execution engine behind Sophie AI.',
    'Sophie is the user-facing assistant. Preserve her calm, direct and helpful personality in the final response.',
    'CURRENT SOPHIE MODE: ' + mode,
    'DETECTED INTENT: ' + intent,
    '',
    'EXECUTION RULES:',
    '1. ACTUALLY PERFORM the requested task when the required tool/capability is available.',
    '2. Do not respond with a tutorial, Python snippet, shell commands, or instructions when the user explicitly asked Sophie to perform the task.',
    '3. For generated files, save them under /home/ubuntu/sophie/workspace unless the user explicitly requested another safe location.',
    '4. Verify important outputs after creating them.',
    '5. If a capability, credential, permission, hardware interface, or device connection is genuinely unavailable, say exactly what is missing. Never pretend the task was completed.',
    '6. Never request, reveal, store, or use SOPHIE_ADMIN_PASSCODE.',
    "7. Do not modify Sophie source code, security controls, or self-upgrade files unless the request is explicitly routed through Sophie's protected self-upgrade system.",
    '8. Use your available browser, terminal, filesystem, image generation, skills, MCP and other configured tools when appropriate.',
    '9. For multi-step tasks, plan internally, execute the steps, verify the result, then report the outcome.',
    '10. Never expose internal filesystem paths, bridge URLs, provider retry details, model fallback details, or implementation/debugging narration to the user. Describe the result naturally and let Sophie render verified artifacts separately.',
    '',
    'LONG-TERM MEMORY:',
    memoryText,
    '',
    'RECENT CONVERSATION:',
    conversationText,
    '',
    'USER REQUEST:',
    command
  ].join('\n');
}

async function executeWithHermes({ command, mode, intent, memoryFacts, conversation, options = {} }) {
  const tool = getTool('ask_hermes');
  if (!tool) throw new Error('Hermes execution tool is not registered.');

  const before = snapshot();
  const query = buildHermesTask({ command, mode, intent, memoryFacts, conversation });

  const result = await tool.execute({ query }, {
    cwd: options.cwd || process.cwd(),
    timeoutMs: options.timeoutMs,
    maxContinuations: options.maxContinuations,
    signal: options.signal,
    onEvent: options.onEvent
  });

  let artifacts = diff(before);

  // Hermes image/file backends can place verified output outside Sophie's
  // workspace (for example the Meta AI WhatsApp bridge). Promote those files
  // into the canonical artifact workspace so the same artifact pipeline can
  // render them inline and list them in Artifacts.
  const discoveredPaths = new Set();
  const responseText = String(result.response || '');
  const pathPatterns = [
    /(?:Image|File|Artifact) saved to:\s*(\/[^\n\r]+)/gi,
    /(?:^|\s)(\/home\/ubuntu\/sophie\/[^\s]+\.(?:png|jpe?g|webp|gif|svg|pdf|docx?|xlsx?|pptx?|csv|txt|md|json|zip))(?:\s|$)/gi
  ];

  for (const pattern of pathPatterns) {
    for (const match of responseText.matchAll(pattern)) {
      const candidate = (match[1] || match[2] || '').trim().replace(/[.,;)]+$/, '');
      if (candidate) discoveredPaths.add(candidate);
    }
  }

  for (const sourcePath of discoveredPaths) {
    try {
      const stat = fs.statSync(sourcePath);
      if (!stat.isFile()) continue;

      const relative = path.relative(WORKSPACE_ROOT, sourcePath);
      if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) continue;

      const destinationDir = path.join(WORKSPACE_ROOT, 'generated');
      fs.mkdirSync(destinationDir, { recursive: true });

      let destination = path.join(destinationDir, path.basename(sourcePath));
      if (fs.existsSync(destination)) {
        const ext = path.extname(destination);
        const stem = path.basename(destination, ext);
        destination = path.join(destinationDir, stem + '-' + Date.now() + ext);
      }

      fs.copyFileSync(sourcePath, destination);
      console.log('[ARTIFACT] Promoted Hermes output:', destination);
    } catch (error) {
      console.warn('[ARTIFACT] Could not promote Hermes output:', sourcePath, error.message);
    }
  }

  artifacts = diff(before);

  return {
    handled: true,
    tool: 'ask_hermes',
    response: result.response || 'Hermes completed the task.',
    sessionId: result.sessionId || null,
    continuationCount: result.continuationCount || 0,
    artifacts
  };
}

async function routeAgent({ command, intent, mode = 'GPT', memoryFacts = [], conversation = [], options = {} }) {
  if (!shouldDelegateToHermes({ command, intent, mode })) return null;
  return executeWithHermes({ command, mode, intent, memoryFacts, conversation, options });
}

module.exports = { buildHermesTask, routeAgent };
