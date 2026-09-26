require('dotenv').config();

const express = require('express');
const { randomUUID } = require('node:crypto');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const identity = require('../core/identity');
const ModuleManager = require('../core/moduleManager');
const Memory = require('../memory/memory');
const CommandProcessor = require('../commands/commandProcessor');
const { analyzeImage } = require('../ai/vision');
const { writeProjectFile } = require('../core/selfWrite');
const { planUpgrade, planAndApplyUpgrade } = require('../core/selfUpgradePlanner');
const { ModeManager } = require('../core/modeManager');
const { listArtifacts, resolveArtifact, WORKSPACE_ROOT } = require('../core/artifactManager');
const {
  applyUpgrade,
  validateProject,
  healthCheck,
  gitStatus
} = require('../core/selfUpgrade');

const app = express();
app.set('trust proxy', 1);

const upgradeSessions = new Map();
const UPGRADE_SESSION_TTL = 30 * 60 * 1000;

function cleanupUpgradeSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of upgradeSessions) {
    if (expiresAt <= now) upgradeSessions.delete(token);
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const parts = header.split(';').map(part => part.trim());
  const prefix = name + '=';
  const found = parts.find(part => part.startsWith(prefix));
  return found ? decodeURIComponent(found.slice(prefix.length)) : null;
}

function hasUpgradeSession(req) {
  cleanupUpgradeSessions();
  const token = getCookie(req, 'sophie_upgrade');
  if (!token) return false;
  const expiresAt = upgradeSessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    upgradeSessions.delete(token);
    return false;
  }
  return true;
}

function clearUpgradeCookie(res) {
  res.setHeader('Set-Cookie', 'sophie_upgrade=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict' + ((process.env.NODE_ENV === 'production') ? '; Secure' : ''));
}

/*
 * --------------------------------------------------
 * BASIC CONFIG
 * --------------------------------------------------
 */

app.use(cors());

app.use(
  express.json({
    limit: '10mb'
  })
);

/*
 * --------------------------------------------------
 * REQUEST DIAGNOSTICS
 * --------------------------------------------------
 */

app.use((req, res, next) => {

  const startedAt = Date.now();

  console.log(
    `[HTTP] ${req.method} ${req.originalUrl} START`
  );

  req.on('aborted', () => {

    console.error(
      `[HTTP] ${req.method} ${req.originalUrl} ABORTED`
    );

  });

  req.on('error', error => {

    console.error(
      `[HTTP] ${req.method} ${req.originalUrl} REQUEST ERROR:`,
      error
    );

  });

  res.on('finish', () => {

    console.log(
      `[HTTP] ${req.method} ${req.originalUrl} FINISHED ${res.statusCode} ${Date.now() - startedAt}ms`
    );

  });

  res.on('close', () => {

    console.log(
      `[HTTP] ${req.method} ${req.originalUrl} CONNECTION CLOSED`
    );

  });

  next();
});

/*
 * --------------------------------------------------
 * STATIC FRONTEND
 * --------------------------------------------------
 */

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);

/*
 * --------------------------------------------------
 * CORE OBJECTS
 * --------------------------------------------------
 */

const moduleManager =
  new ModuleManager();

const memory =
  new Memory();

const modeManager =
  new ModeManager();

const activeCommands = new Map();

function updateCommandStatus(requestId, patch = {}) {
  const task = activeCommands.get(requestId);
  if (!task) return;

  Object.assign(task, patch, {
    updatedAt: Date.now()
  });
}

function summarizeHermesEvent(event) {
  const tool = String(
    event?.tool || event?.name || ''
  ).toLowerCase();

  const map = {
    read_file: 'Reading files…',
    search_files: 'Searching files…',
    terminal: 'Running terminal inspection…',
    execute_code: 'Running code…',
    write_file: 'Writing a file…',
    browser: 'Using the browser…',
    web_search: 'Searching the web…',
    system: 'Starting Hermes…'
  };

  return map[tool] ||
    (tool ? 'Hermes: ' + tool : null);
}

const commandProcessor =
  new CommandProcessor({
    identity,
    moduleManager,
    memory,
    modeManager
  });

/*
 * --------------------------------------------------
 * ROOT
 * --------------------------------------------------
 */

app.get('/', (req, res) => {

  res.json({
    name: identity.name,
    status: 'online',
    version: identity.version
  });

});

/*
 * --------------------------------------------------
 * STATUS
 * --------------------------------------------------
 */

app.get('/api/status', (req, res) => {

  res.json({

    name:
      identity.name,

    version:
      identity.version,

    status:
      'online',

    modules:
      moduleManager.list(),

    discoveredModules:
      moduleManager.discover(),

    memoryFacts:
      memory.getFacts().length,

    mode:
      modeManager.describe()

  });

});

/*
 * --------------------------------------------------
 * OPERATING MODE
 * --------------------------------------------------
 */

app.get('/api/mode', (req, res) => {
  res.json(modeManager.describe());
});

app.post('/api/mode', (req, res) => {
  try {
    const { mode } = req.body || {};
    const selected = modeManager.setMode(mode);
    res.json(modeManager.describe());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/*
 * --------------------------------------------------
 * COMMAND
 * --------------------------------------------------
 */



app.post('/api/command', async (req, res) => {

  console.log(
    '[COMMAND] Request received'
  );

  try {

    const { command, requestId: suppliedRequestId } =
      req.body;

    const requestId =
      typeof suppliedRequestId === 'string' &&
      suppliedRequestId.trim()
        ? suppliedRequestId.trim()
        : randomUUID();

    const controller = new AbortController();

    activeCommands.set(requestId, {
      controller,
      status: 'working',
      activity: 'Planning the task…',
      startedAt: Date.now(),
      updatedAt: Date.now()
    });

    const upgradeAuthorized = hasUpgradeSession(req);

    if (
      typeof command !== 'string'
    ) {

      return res.status(400).json({
        error:
          'command must be a string'
      });

    }

    console.log(
      `[COMMAND] Processing: ${command}`
    );

    const result =
      await commandProcessor.process(
        command,
        {
          upgradeAuthorized,
          signal: controller.signal,
          onEvent: event => {
            const activity =
              summarizeHermesEvent(event);

            if (activity) {
              updateCommandStatus(
                requestId,
                { activity }
              );
            }
          }
        }
      );

    updateCommandStatus(requestId, {
      status: 'complete',
      activity: 'Completed.'
    });

    console.log(
      '[COMMAND] Response ready'
    );

    if (result && result.restartAfterResponse) {
      setTimeout(() => {
        try {
          const { restartSophie } = require('../core/selfUpgrade');
          const restartResult = restartSophie();
          console.log('[SELF-UPGRADE] Restart after chat response:', restartResult);
        } catch (error) {
          console.error('[SELF-UPGRADE] Deferred restart failed:', error);
        }
      }, 1500);
    }

    if (!res.headersSent) {
      res.json({
        ...result,
        requestId
      });
    }

    setTimeout(
      () => activeCommands.delete(requestId),
      60000
    );

  } catch (error) {

    const requestId =
      typeof req.body?.requestId === 'string'
        ? req.body.requestId
        : null;

    if (requestId) {
      updateCommandStatus(requestId, {
        status:
          error?.code === 'HERMES_CANCELLED'
            ? 'cancelled'
            : 'error',

        activity:
          error?.code === 'HERMES_CANCELLED'
            ? 'Stopped by you.'
            : 'Request failed.'
      });
    }

    console.error(
      '[COMMAND] ERROR:',
      error
    );

    if (!res.headersSent) {

      res.status(500).json({
        error:
          'Internal Sophie error'
      });

    }

  }

});

/*
 * --------------------------------------------------
 * COMMAND STATUS / CANCEL
 * --------------------------------------------------
 */

app.get(
  '/api/command/status/:requestId',
  (req, res) => {
    const task =
      activeCommands.get(req.params.requestId);

    if (!task) {
      return res.status(404).json({
        error: 'Request not found.'
      });
    }

    res.json({
      requestId: req.params.requestId,
      status: task.status,
      activity: task.activity,
      startedAt: task.startedAt,
      updatedAt: task.updatedAt
    });
  }
);

app.post(
  '/api/command/:requestId/cancel',
  (req, res) => {
    const task =
      activeCommands.get(req.params.requestId);

    if (!task) {
      return res.status(404).json({
        error: 'Request not found.'
      });
    }

    if (task.status !== 'working') {
      return res.json({
        ok: true,
        status: task.status
      });
    }

    updateCommandStatus(
      req.params.requestId,
      {
        status: 'cancelling',
        activity: 'Stopping…'
      }
    );

    task.controller.abort();

    res.json({
      ok: true,
      status: 'cancelling'
    });
  }
);

/*
 * --------------------------------------------------
 * ARTIFACTS
 * --------------------------------------------------
 */

app.get('/api/artifacts', (req, res) => {
  try {
    res.json({
      workspace: WORKSPACE_ROOT,
      artifacts: listArtifacts()
    });
  } catch (error) {
    res.status(500).json({ error: 'Could not list workspace artifacts.' });
  }
});

app.get('/api/artifacts/download', (req, res) => {
  try {
    const filePath = resolveArtifact(req.query.path);
    res.download(filePath, path.basename(filePath));
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

/*
 * --------------------------------------------------
 * VISION
 * --------------------------------------------------
 */



app.post('/api/vision', async (req, res) => {

  console.log(
    '[VISION] Request received'
  );

  try {

    const {
      image,
      mimeType,
      question
    } = req.body;

    if (!image) {

      return res.status(400).json({
        error:
          'image is required'
      });

    }

    console.log(
      `[VISION] Image received: ${image.length} base64 characters`
    );

    console.log(
      `[VISION] MIME type: ${mimeType || 'image/jpeg'}`
    );

    console.log(
      `[VISION] Question: ${question || 'default'}`
    );

    const result =
      await analyzeImage(
        image,
        mimeType || 'image/jpeg',
        question ||
          'Describe what you can see in this image clearly.'
      );

    console.log(
      '[VISION] Gemini response ready'
    );

    if (!res.headersSent) {

      res.json({

        type:
          'vision',

        text:
          result

      });

    }

  } catch (error) {

    console.error(
      '[VISION] ERROR:',
      error
    );

    if (!res.headersSent) {

      res.status(500).json({

        error:
          'Sophie vision failed',

        details:
          error.message

      });

    }

  }

});

/*
 * --------------------------------------------------
 * SELF-UPGRADE
 * --------------------------------------------------
 *
 * This endpoint is deliberately protected by the same
 * admin passcode used by selfWrite.
 *
 * It accepts explicit file changes generated by the
 * upgrade planner. It does NOT execute arbitrary shell
 * commands supplied by the AI.
 */

app.post('/api/self-upgrade/session', (req, res) => {
  try {
    const { passcode } = req.body;
    const realPasscode = process.env.SOPHIE_ADMIN_PASSCODE;

    if (!realPasscode || !passcode || passcode !== realPasscode) {
      return res.status(401).json({ error: 'Incorrect passcode' });
    }

    cleanupUpgradeSessions();
    const token = crypto.randomBytes(32).toString('hex');
    upgradeSessions.set(token, Date.now() + UPGRADE_SESSION_TTL);

    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const cookie = [
      'sophie_upgrade=' + encodeURIComponent(token),
      'Max-Age=' + Math.floor(UPGRADE_SESSION_TTL / 1000),
      'Path=/',
      'HttpOnly',
      'SameSite=Strict'
    ];
    if (secure) cookie.push('Secure');

    res.setHeader('Set-Cookie', cookie.join('; '));
    res.json({ ok: true, expiresIn: UPGRADE_SESSION_TTL });
  } catch (error) {
    console.error('[SELF-UPGRADE SESSION] ERROR:', error);
    res.status(500).json({ error: 'Could not start upgrade mode' });
  }
});

app.delete('/api/self-upgrade/session', (req, res) => {
  try {
    const token = getCookie(req, 'sophie_upgrade');
    if (token) upgradeSessions.delete(token);
    clearUpgradeCookie(res);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Could not end upgrade mode' });
  }
});

app.get('/api/self-upgrade/session', (req, res) => {
  res.json({ authorized: hasUpgradeSession(req) });
});

app.get('/api/self-upgrade/status', (req, res) => {
  try {
    res.json({
      validation: validateProject(),
      health: null,
      git: gitStatus()
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.post('/api/self-upgrade/plan', async (req, res) => {
  try {
    const { passcode, command } = req.body;
    if (!passcode || !command) return res.status(400).json({ error: 'passcode and command are required' });
    if (!process.env.SOPHIE_ADMIN_PASSCODE || passcode !== process.env.SOPHIE_ADMIN_PASSCODE) {
      return res.status(401).json({ error: 'Incorrect passcode' });
    }
    res.json(await planUpgrade(command));
  } catch (error) {
    console.error('[SELF-UPGRADE PLAN] ERROR:', error);
    res.status(422).json({ error: error.message });
  }
});

app.post('/api/self-upgrade/chat', async (req, res) => {
  try {
    const { passcode, command, checkpoint = true, restart = false, checkpointMessage } = req.body;
    if (!passcode || !command) return res.status(400).json({ error: 'passcode and command are required' });
    if (!process.env.SOPHIE_ADMIN_PASSCODE || passcode !== process.env.SOPHIE_ADMIN_PASSCODE) {
      return res.status(401).json({ error: 'Incorrect passcode' });
    }
    const result = await planAndApplyUpgrade({ command, checkpoint, restart, checkpointMessage });
    res.status(result.ok ? 200 : 422).json(result);
  } catch (error) {
    console.error('[SELF-UPGRADE CHAT] ERROR:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/self-upgrade', async (req, res) => {
  try {
    const {
      passcode,
      changes,
      checkpoint = true,
      restart = false,
      checkpointMessage
    } = req.body;

    if (!passcode) {
      return res.status(401).json({
        error: 'Admin passcode is required'
      });
    }

    if (!Array.isArray(changes) || changes.length === 0) {
      return res.status(400).json({
        error: 'changes must be a non-empty array'
      });
    }

    if (changes.length > 20) {
      return res.status(400).json({
        error: 'A single upgrade may modify at most 20 files'
      });
    }

    const realPasscode = process.env.SOPHIE_ADMIN_PASSCODE;

    if (!realPasscode || passcode !== realPasscode) {
      return res.status(401).json({
        error: 'Incorrect passcode'
      });
    }

    const result = await applyUpgrade({
      changes,
      checkpoint,
      restart,
      checkpointMessage
    });

    res.status(result.ok ? 200 : 422).json(result);

  } catch (error) {
    console.error('[SELF-UPGRADE] ERROR:', error);

    if (!res.headersSent) {
      res.status(500).json({
        error: error.message
      });
    }
  }
});

/*
 * --------------------------------------------------
 * THREADS (Chats and Projects)
 * --------------------------------------------------
 */

app.get('/api/threads', (req, res) => {
  try {
    res.json({
      threads: memory.listThreads(),
      activeThreadId: memory.getActiveThreadId()
    });
  } catch (error) {
    console.error('[THREADS] list error:', error);
    res.status(500).json({ error: 'Could not list threads' });
  }
});

app.get('/api/threads/active', (req, res) => {
  try {
    res.json(memory.getActiveThread());
  } catch (error) {
    console.error('[THREADS] active error:', error);
    res.status(500).json({ error: 'Could not load active thread' });
  }
});

app.post('/api/threads', (req, res) => {
  try {
    const { type, title } = req.body;

    if (!title || (type !== 'chat' && type !== 'project')) {
      return res.status(400).json({ error: 'type ("chat" or "project") and title are required' });
    }

    const thread = memory.createThread(type, title);
    res.json(thread);
  } catch (error) {
    console.error('[THREADS] create error:', error);
    res.status(500).json({ error: 'Could not create thread' });
  }
});

app.post('/api/write-file', (req, res) => {
  try {
    const { path: filePath, content, passcode } = req.body;

    if (!filePath || content === undefined || !passcode) {
      return res.status(400).json({ error: 'path, content, and passcode are required' });
    }

    const result = writeProjectFile(filePath, content, passcode);

    console.log(`[WRITE] ${result.path} (${result.bytesWritten} bytes), backup: ${result.backupPath || 'none (new file)'}`);

    res.json(result);
  } catch (error) {
    console.error('[WRITE] error:', error.message);

    const status = error.message.includes('passcode')
      ? 401
      : error.message.includes('denied')
        ? 403
        : 500;

    res.status(status).json({ error: error.message });
  }
});

app.patch('/api/threads/:id', (req, res) => {
  try {
    const { title } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }

    const thread = memory.renameThread(req.params.id, title.trim());
    res.json(thread);
  } catch (error) {
    console.error('[THREADS] rename error:', error);
    res.status(404).json({ error: error.message });
  }
});

app.delete('/api/threads/:id', (req, res) => {
  try {
    const newActive = memory.deleteThread(req.params.id);
    res.json(newActive);
  } catch (error) {
    console.error('[THREADS] delete error:', error);
    res.status(400).json({ error: error.message });
  }
});





app.post('/api/threads/:id/activate', (req, res) => {
  try {
    memory.setActiveThread(req.params.id);
    res.json(memory.getActiveThread());
  } catch (error) {
    console.error('[THREADS] activate error:', error);
    res.status(404).json({ error: error.message });
  }
});

/*
 * --------------------------------------------------
 * EXPRESS ERROR HANDLER
 * --------------------------------------------------
 */

app.use((error, req, res, next) => {

  console.error(
    '[EXPRESS ERROR]',
    error
  );

  if (
    error.type === 'entity.too.large'
  ) {

    return res.status(413).json({
      error:
        'Request image is too large.'
    });

  }

  if (!res.headersSent) {

    res.status(500).json({
      error:
        'Sophie server error.'
    });

  }

});

/*
 * --------------------------------------------------
 * START SERVER
 * --------------------------------------------------
 */

const PORT =
  Number(process.env.PORT) || 3000;

const server =
  app.listen(
    PORT,
    '0.0.0.0',
    () => {

      console.log('');
      console.log(
        '================================='
      );
      console.log(
        '        SOPHIE ONLINE'
      );
      console.log(
        '================================='
      );
      console.log(
        `Version: ${identity.version}`
      );
      console.log(
        `Port: ${PORT}`
      );
      console.log(
        `Environment: ${process.env.NODE_ENV}`
      );
      console.log(
        '================================='
      );
      console.log('');

    }
  );

/*
 * --------------------------------------------------
 * HTTP CONNECTION SETTINGS
 * --------------------------------------------------
 */

server.keepAliveTimeout =
  65000;

server.headersTimeout =
  66000;

/*
 * --------------------------------------------------
 * SERVER ERRORS
 * --------------------------------------------------
 */

server.on('error', error => {

  console.error(
    '[SERVER ERROR]',
    error
  );

});

process.on('uncaughtException', error => {

  console.error(
    '[PROCESS] uncaughtException:',
    error
  );

});

process.on('unhandledRejection', error => {

  console.error(
    '[PROCESS] unhandledRejection:',
    error
  );

});
