require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const identity = require('../core/identity');
const ModuleManager = require('../core/moduleManager');
const Memory = require('../memory/memory');
const CommandProcessor = require('../commands/commandProcessor');
const { analyzeImage } = require('../ai/vision');
const { writeProjectFile } = require('../core/selfWrite');
const {
  applyUpgrade,
  validateProject,
  healthCheck,
  gitStatus
} = require('../core/selfUpgrade');

const app = express();

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

const commandProcessor =
  new CommandProcessor({
    identity,
    moduleManager,
    memory
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
      memory.getFacts().length

  });

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

    const { command } =
      req.body;

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
        command
      );

    console.log(
      '[COMMAND] Response ready'
    );

    if (!res.headersSent) {

      res.json(result);

    }

  } catch (error) {

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
