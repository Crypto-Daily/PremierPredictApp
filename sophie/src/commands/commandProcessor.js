const { routeTool } = require('../tools/toolRouter');
const { askWithFallback, askAllRanked } = require('../ai/providerRouter');
const { routeIntent } = require('../ai/intentRouter');
const { buildSophiePrompt } = require('../ai/prompt');
const { getCurrentTimeContext } = require('../core/time');
const { performWebResearch } = require('../research/webSearch');
const { fetchAndSummarizeUrl } = require('../research/urlFetch');
const { planAndApplyUpgrade } = require('../core/selfUpgradePlanner');
const {
  listProjectFiles,
  readProjectFile,
  resolveModuleQuery,
  listDirectory,
  readAnyFile,
  findByName
} = require('../core/selfInspect');

const HELP_TEXT = `Here's what I can do with fixed, predictable commands (no guessing involved):

THREADS
- "list my projects" / "list my chats"
- "start/create a project called X"
- "start a new chat"
- "switch/go to X"

MY OWN CODE (read-only)
- "what files make up your AI system"
- "where is your memory/vision/research/prompt/... code"
- "I'm looking for X" / "find X" — fuzzy name search

FILES ON THE SERVER (read-only, everywhere except secrets)
- "list files in <path>" — try "the server" or "everything" for your home directory, or a real path like "/etc" or "bybit-ai-bot"
- "read file <path>"

LINKS
- Paste a URL anywhere in your message and I'll actually fetch and read it.

WHAT I CANNOT DO YET
- Generate PDF/DOCX/ZIP files, create download links, or run arbitrary shell commands. If I ever claim to have done one of these, that's a bug — tell me.

Writing/editing my own files is protected by Upgrade Mode. Authenticate in Settings → Upgrade Mode first, then describe the change normally in chat. Passcodes typed in chat are blocked and never saved.`;

const PATH_ALIASES = {
  'the server': null,
  'my server': null,
  'server': null,
  'everything': null,
  'the whole server': '/',
  'root': '/',
  'system root': '/',
  'home': null,
  'my files': null,
  'sophie': 'src'
};

const os = require('os');
const HOME_DIR = os.homedir();

function normalizePathArg(raw) {
  const cleaned = raw.trim().toLowerCase();

  if (cleaned in PATH_ALIASES) {
    return PATH_ALIASES[cleaned] === null ? HOME_DIR : PATH_ALIASES[cleaned];
  }

  return raw.trim();
}

// Language implying a capability we don't have — answer honestly instead of
// letting it fall through to general AI chat, which will improvise one.
const UNSUPPORTED_ACTION_PATTERN = /\b(generate (a |the )?pdf|convert .*(to|into) (pdf|docx|word)|create (a |the )?(pdf|docx|word document|zip|download link)|download link|scan the (server|whole server)|zip (the|this) (folder|project)|signed url|temporary url)\b/i;

class CommandProcessor {
  constructor({ identity, moduleManager, memory }) {
    this.identity = identity;
    this.moduleManager = moduleManager;
    this.memory = memory;
  }

  async process(input, options = {}) {
    const command = input.trim();
    const upgradeAuthorized = options.upgradeAuthorized === true;

    if (!command) {
      return { type: 'response', text: 'I am listening.' };
    }

    // =========================
    // PASSCODE GUARD — must run before anything is stored or forwarded
    // =========================

    const realPasscode = process.env.SOPHIE_ADMIN_PASSCODE;

    if (realPasscode && command.includes(realPasscode)) {
      console.warn('[SECURITY] A message containing the admin passcode was blocked before storage.');

      const text =
        "That message looks like it contains your admin passcode. I never store or forward passcodes through chat, so I'm not saving this message and it was never sent to any AI provider. To edit my own code, use Settings → Upgrade Mode and authenticate there first.";

      return { type: 'response', text };
    }

    this.memory.addMessage('user', command);

    const lower = command.toLowerCase();

    if (lower === 'hello' || lower === 'hi' || lower === 'hey sophie') {
      const text = `Hello. I am ${this.identity.name}.`;
      this.memory.addMessage('assistant', text);
      return { type: 'response', text };
    }

    if (lower.includes('who are you') || lower.includes('what are you')) {
      const text = `I am ${this.identity.name}, version ${this.identity.version}. I am your personal AI assistant.`;
      this.memory.addMessage('assistant', text);
      return { type: 'response', text };
    }

    if (/^(help|commands?|command list|what can (i|you) (ask|do))\??$/i.test(lower)) {
      this.memory.addMessage('assistant', HELP_TEXT);
      return { type: 'response', text: HELP_TEXT };
    }

    if (UNSUPPORTED_ACTION_PATTERN.test(lower)) {
      const text =
        "I don't actually have that capability yet — no PDF/DOCX/ZIP generation, no download links, no server-wide \"scan\" action. I can read and list real files (say \"help\" for exact commands), but I won't pretend to do more than that.";
      this.memory.addMessage('assistant', text);
      return { type: 'response', text };
    }

    if (lower === 'status') {
      return {
        type: 'status',
        data: {
          name: this.identity.name,
          version: this.identity.version,
          modules: this.moduleManager.list(),
          discoveredModules: this.moduleManager.discover(),
          memoryFacts: this.memory.getFacts().length,
          conversationMessages: this.memory.getConversationCount(),
          activeThreadId: this.memory.getActiveThreadId()
        }
      };
    }

    if (lower.startsWith('remember ')) {
      let fact = command.substring(9).trim();

      if (fact.toLowerCase().startsWith('that ')) {
        fact = fact.substring(5).trim();
      }

      if (fact) {
        this.memory.rememberFact(fact);
        const text = `I will remember that: ${fact}`;
        this.memory.addMessage('assistant', text);
        return { type: 'response', text };
      }
    }

    if (/^(list|show) (my )?(projects|chats|threads)/i.test(lower)) {
      const threads = this.memory.listThreads();
      const active = this.memory.getActiveThreadId();

      const lines = threads.map(t =>
        `- ${t.title} (${t.type})${t.id === active ? ' ← current' : ''} — ${t.messageCount} messages`
      );

      const text = `Here's what you have:\n\n${lines.join('\n')}`;
      this.memory.addMessage('assistant', text);
      return { type: 'response', text };
    }

    const newProjectMatch = command.match(/^(?:start|create|new) (?:a )?project(?: called| named)?\s+(.+)$/i);

    if (newProjectMatch) {
      const title = newProjectMatch[1].trim();
      this.memory.createThread('project', title);
      const text = `Created new project: ${title}. This is now active — anything we discuss stays scoped to it.`;
      this.memory.addMessage('assistant', text);
      return { type: 'response', text };
    }

    if (/^(?:start|new) (?:a )?chat$/i.test(command.trim())) {
      this.memory.createThread('chat', `Chat ${new Date().toLocaleDateString()}`);
      const text = `Started a new chat.`;
      this.memory.addMessage('assistant', text);
      return { type: 'response', text };
    }

    const switchMatch = command.match(/^(?:switch|go) to\s+(?:project\s+|chat\s+)?(.+)$/i);

    if (switchMatch) {
      const name = switchMatch[1].trim();
      const thread = this.memory.findThreadByTitle(name);

      if (thread) {
        this.memory.setActiveThread(thread.id);
        const text = `Switched to "${thread.title}" (${thread.type}).`;
        this.memory.addMessage('assistant', text);
        return { type: 'response', text };
      }

      const text = `I couldn't find a chat or project called "${name}". Say "list my projects" to see what's available.`;
      this.memory.addMessage('assistant', text);
      return { type: 'response', text };
    }

    const intent = routeIntent(command);

    console.log(`[INTENT] ${intent}`);

    if (intent === 'SELF_UPGRADE') {
      if (!upgradeAuthorized) {
        const text = 'Self-upgrade is locked. Open Settings → Upgrade Mode and authenticate first. I will not accept an admin passcode through normal chat.';
        this.memory.addMessage('assistant', text);
        return { type: 'response', text, upgradeLocked: true };
      }

      try {
        const result = await planAndApplyUpgrade({
          command,
          checkpoint: true,
          restart: false,
          checkpointMessage: 'Sophie natural-language self-upgrade'
        });

        if (!result.ok) {
          const text = `I could not safely apply that upgrade. Stage: ${result.stage || 'unknown'}.`;
          this.memory.addMessage('assistant', text);
          return { type: 'response', text, upgrade: result };
        }

        const changed = Array.isArray(result.changed) ? result.changed.join(', ') : 'the requested files';
        const text = `Upgrade applied successfully. I changed: ${changed}. My code passed validation and a checkpoint was created. I will restart after this response.`;
        this.memory.addMessage('assistant', text);
        return { type: 'response', text, upgrade: result, restartAfterResponse: true };
      } catch (error) {
        console.error('[SELF-UPGRADE CHAT] ERROR:', error);
        const text = `I could not complete that self-upgrade safely: ${error.message}`;
        this.memory.addMessage('assistant', text);
        return { type: 'response', text, upgradeError: true };
      }
    }
    if (intent === 'SELF_INSPECT') {
      let text;

      const listDirMatch = command.match(/^(?:please\s+)?list (?:the )?files (?:in|on)\s+(.+)$/i);
      const readFileMatch = command.match(/^(?:please\s+)?(?:read file|show me the file|show me file)\s+(.+)$/i);

      if (listDirMatch) {
        const targetPath = normalizePathArg(listDirMatch[1]);

        try {
          const entries = listDirectory(targetPath);
          text = `Contents of ${targetPath}:\n\n${entries.map(e => `- ${e}`).join('\n')}`;
        } catch (error) {
          text = `Couldn't list that: ${error.message}\n\nSay "help" for the exact command list.`;
        }
      } else if (readFileMatch) {
        const targetPath = normalizePathArg(readFileMatch[1]);

        try {
          const file = readAnyFile(targetPath);
          text =
            `File: ${file.path}\n\n\`\`\`\n${file.content}\n\`\`\`` +
            (file.truncated ? `\n\n[truncated — showing first 6000 of ${file.totalLength} characters]` : '');
        } catch (error) {
          text = `Couldn't read that: ${error.message}`;
        }
      } else if (/what files|architecture|full list/i.test(lower)) {
        const files = listProjectFiles();
        text = `My source is organized as:\n\n${files.map(f => `- ${f}`).join('\n')}`;
      } else {
        const matchedPath = resolveModuleQuery(command);

        if (matchedPath) {
          try {
            const file = readProjectFile(matchedPath);
            text =
              `File: ${file.path}\n\n\`\`\`\n${file.content}\n\`\`\`` +
              (file.truncated ? `\n\n[truncated — showing first 6000 of ${file.totalLength} characters]` : '');
          } catch (error) {
            text = `I couldn't read that file: ${error.message}`;
          }
        } else {
          const searchTerm = command
            .replace(/\b(i am|i'm)?\s*looking for\b/i, '')
            .replace(/\bwhere is\b/i, '')
            .replace(/\bfind\b/i, '')
            .replace(/\baccess (my|the)\b/i, '')
            .replace(/\b(folder|file|located|list the folders there)\b/gi, '')
            .trim();

          const matches = findByName(searchTerm || command);

          if (matches.length === 0) {
            text = `I searched and couldn't find anything matching "${searchTerm || command}". Say "help" to see exact command syntax.`;
          } else if (matches.length === 1) {
            text = `Found it: ${matches[0].path} (${matches[0].type}).`;
          } else {
            text =
              `Found ${matches.length} matches for "${searchTerm || command}":\n\n` +
              matches.map(m => `- ${m.path} (${m.type})`).join('\n');
          }
        }
      }

      this.memory.addMessage('assistant', text);
      return { type: 'response', text };
    }

    /*
     * Hermes tool routing.
     *
     * Protected self-upgrade and self-inspection branches above
     * remain exclusively handled by Sophie.
     */
    try {
      const toolResult = await routeTool(command, {
        intent,
        signal: options.signal,
        onEvent: options.onEvent
      });

      if (toolResult?.handled) {
        const response = toolResult.response;

        this.memory.addMessage('assistant', response);

        console.log(`[TOOL] ${toolResult.tool} handled the request.`);

        return {
          type: 'response',
          text: response,
          tool: toolResult.tool,
          sessionId: toolResult.sessionId || null
        };
      }
    } catch (error) {
      console.error('[TOOL] Hermes error:', error);

      const text =
        'I tried to use my external agent capability, but it is unavailable right now.';

      this.memory.addMessage('assistant', text);

      return {
        type: 'response',
        text
      };
    }

    try {
      const memoryFacts = this.memory.getFacts();

      const conversation = this.memory.getRecentMessages(21).slice(0, -1);

      const useWebSearch =
        intent !== 'MEMORY' &&
        intent !== 'CREATION' &&
        intent !== 'DEVICE_CONTROL' &&
        intent !== 'VISION';

      let researchResults = null;

      if (useWebSearch) {
        researchResults = await performWebResearch(command);
        console.log(`[RESEARCH] found=${researchResults.found}`);
      }

      // If the message contains a URL, actually fetch it — regardless of intent —
      // and fold the real page content into the research context.
      const urlMatch = command.match(/https?:\/\/[^\s]+/);

      if (urlMatch) {
        const urlResult = await fetchAndSummarizeUrl(urlMatch[0]);

        const urlBlock = urlResult.found
          ? `Fetched content from ${urlResult.url}:\n${urlResult.text}`
          : urlResult.text;

        if (researchResults) {
          researchResults = {
            ...researchResults,
            found: true,
            text: `${researchResults.text}\n\n${urlBlock}`
          };
        } else {
          researchResults = { query: command, found: true, text: urlBlock, groundTruthTerms: [] };
        }
      }

      const systemInstruction = buildSophiePrompt({
        memoryFacts,
        conversation,
        timeContext: getCurrentTimeContext(),
        researchResults
      });

      let result;

      if (intent === 'WEB_RESEARCH') {
        result = await askAllRanked(command, systemInstruction, {
          useWebSearch,
          groundTruthTerms: researchResults?.groundTruthTerms || []
        });
      } else {
        result = await askWithFallback(command, systemInstruction, { useWebSearch });
      }

      const response = result.text;

      console.log(`[AI] Provider: ${result.provider}`);

      this.memory.addMessage('assistant', response);

      return { type: 'response', text: response };

    } catch (error) {
      console.error('AI error:', error);

      const text = 'I am having trouble reaching my AI brain right now. Please try again.';
      this.memory.addMessage('assistant', text);

      return { type: 'response', text };
    }
  }
}

module.exports = CommandProcessor;
