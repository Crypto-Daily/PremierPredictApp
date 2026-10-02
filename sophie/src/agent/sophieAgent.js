'use strict';

const { shouldDelegateToHermes } = require('./agentPolicy');
const { getTool } = require('../tools');
const { snapshot, diff, WORKSPACE_ROOT } = require('../core/artifactManager');
const fs = require('node:fs');
const path = require('node:path');

function cleanHermesUserResponse(text) {
  const lines = String(text || '').split(/\r?\n/);
  const hidden = [];
  let skipping = false;

  for (const line of lines) {
    const lower = line.toLowerCase().trim();

    if (
      lower.startsWith('image saved to:') ||
      lower.startsWith('file saved to:') ||
      lower.startsWith('artifact saved to:') ||
      lower.startsWith('generated via meta ai') ||
      lower.startsWith('the first default attempt came back empty') ||
      lower.startsWith('retried with the ') ||
      lower.includes('which routed successfully through the same backend')
    ) {
      skipping = true;
      continue;
    }

    if (skipping) {
      if (!lower || lower.startsWith('let me know') || lower.startsWith('here')) skipping = false;
      else continue;
    }

    if (
      lower.includes('/home/ubuntu/sophie/') ||
      lower.includes('whatsmeow bridge') ||
      lower.includes('provider name') ||
      lower.includes('verified on disk')
    ) {
      continue;
    }

    hidden.push(line);
  }

  const cleaned = hidden.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned || 'Done.';
}

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

  const responseText = String(result.response || '');
  const discoveredPaths = new Set();
  const pathPatterns = [
    /(?:Image|File|Artifact) saved to:\s*\`?([^\`\n\r]+)\`?/gi,
    /((?:\/home\/ubuntu\/sophie)\/[^\s\`]+\.(?:png|jpe?g|webp|gif|svg|pdf|docx?|xlsx?|pptx?|csv|txt|md|json|zip))/gi
  ];

  for (const pattern of pathPatterns) {
    for (const match of responseText.matchAll(pattern)) {
      const candidate = (match[1] || '').trim().replace(/[.,;)]+$/, '');
      if (candidate) discoveredPaths.add(candidate);
    }
  }

  const promotedArtifacts = [];

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

      const relativeArtifact = path.relative(WORKSPACE_ROOT, destination).split(path.sep).join('/');
      const destinationStat = fs.statSync(destination);
      const ext = path.extname(destination).toLowerCase();
      const mimeTypes = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf', '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt': 'application/vnd.ms-powerpoint',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.csv': 'text/csv', '.txt': 'text/plain', '.md': 'text/markdown',
        '.json': 'application/json', '.zip': 'application/zip'
      };

      promotedArtifacts.push({
        path: relativeArtifact,
        size: destinationStat.size,
        modifiedAt: destinationStat.mtime.toISOString(),
        mimeType: mimeTypes[ext] || 'application/octet-stream'
      });

      console.log('[ARTIFACT] Promoted Hermes output:', destination);
    } catch (error) {
      console.warn('[ARTIFACT] Could not promote Hermes output:', sourcePath, error.message);
    }
  }

  const artifacts = [
    ...diff(before),
    ...promotedArtifacts
  ].filter((artifact, index, list) =>
    list.findIndex(item => item.path === artifact.path) === index
  );

  return {
    handled: true,
    tool: 'ask_hermes',
    response: cleanHermesUserResponse(responseText),
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
