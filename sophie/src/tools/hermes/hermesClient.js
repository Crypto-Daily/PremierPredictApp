'use strict';

const { spawn } = require('node:child_process');

const HERMES_BIN =
  process.env.HERMES_BIN || '/home/ubuntu/.local/bin/hermes';

const DEFAULT_TIMEOUT_MS = 600000;
const DEFAULT_MAX_CONTINUATIONS = 1;
const MAX_OUTPUT_CHARS = 500000;

function buildHermesEnv() {
  const env = { ...process.env };

  delete env.SOPHIE_ADMIN_PASSCODE;

  for (const key of Object.keys(env)) {
    if (
      /(_KEY|_TOKEN|_SECRET|_PASSWORD|_PASSCODE)$/i.test(key) ||
      /^(API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/i.test(key)
    ) {
      delete env[key];
    }
  }

  return env;
}

function parseStreamJsonLine(line, state) {
  if (!line.trim()) return;

  let event;

  try {
    event = JSON.parse(line);
  } catch {
    state.nonJson.push(line);
    return;
  }

  state.events.push(event);

  if (typeof state.onEvent === 'function') {
    try {
      state.onEvent(event);
    } catch (error) {
      console.error('[HERMES] event callback error:', error.message);
    }
  }

  if (event.session_id && !state.sessionId) {
    state.sessionId = event.session_id;
    console.log(`[HERMES] session: ${state.sessionId}`);
  }

  if (event.type !== 'text') {
    const summary =
      event.message ||
      event.content ||
      event.tool ||
      event.name ||
      event.type;

    if (typeof summary === 'string' && summary.trim()) {
      console.log(`[HERMES] ${summary.trim().slice(0, 1000)}`);
    } else {
      console.log(`[HERMES] ${event.type}`);
    }
  }

  if (event.type === 'text' && typeof event.text === 'string') {
    state.text += event.text;
  }

  if (
    event.type === 'result' &&
    typeof event.text === 'string' &&
    !state.text
  ) {
    state.text = event.text;
  }

  if (event.type === 'result') {
    state.result = event;
  }
}

function runHermesOnce(query, options = {}) {
  if (typeof query !== 'string' || !query.trim()) {
    return Promise.reject(
      new Error('Hermes query must be a non-empty string.')
    );
  }

  const timeoutMs = Number(
    options.timeoutMs || DEFAULT_TIMEOUT_MS
  );

  const runBudgetSeconds = Math.max(
    1,
    Math.floor(timeoutMs / 1000)
  );

  const args = [
    'chat',
    '--oneshot',
    '--quiet',
    '--source',
    'tool',
    '--format',
    'stream-json',
    '--run-budget',
    String(runBudgetSeconds),
    '-q',
    query
  ];

  if (options.model) {
    args.push('--model', options.model);
  }

  if (options.toolsets) {
    args.push('--toolsets', options.toolsets);
  }

  if (options.resumeSessionId) {
    args.push('--resume', options.resumeSessionId);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(HERMES_BIN, args, {
      cwd: options.cwd || process.cwd(),
      env: buildHermesEnv(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const state = {
      events: [],
      text: '',
      result: null,
      sessionId: options.resumeSessionId || null,
      nonJson: [],
      stdoutChars: 0,
      stderr: '',
      onEvent: options.onEvent || null
    };

    let settled = false;
    let abortHandler = null;

    const finish = (fn, value) => {
      if (settled) return;

      settled = true;
      clearTimeout(watchdog);

      if (abortHandler && options.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }

      fn(value);
    };

    /*
     * Hermes owns the real 10-minute budget.
     *
     * This watchdog is intentionally slightly longer so we do not
     * kill Hermes before it can persist its session.
     */
    const watchdog = setTimeout(() => {
      const sessionId =
        state.sessionId ||
        state.result?.session_id ||
        null;

      console.log(
        `[HERMES] Watchdog reached ${timeoutMs}ms. ` +
        `Allowing Hermes to finish/persist its session.` +
        ` Session: ${sessionId || 'unknown'}`
      );

      /*
       * Do NOT kill Hermes here.
       *
       * Hermes' --run-budget is responsible for stopping the run
       * and persisting the resumable session.
       *
       * Give it an additional 15 seconds to emit its final result.
       */
      setTimeout(() => {
        if (settled) return;

        finish(
          reject,
          Object.assign(
            new Error(
              `Hermes did not finish after its ${timeoutMs}ms run budget.`
            ),
            {
              code: 'HERMES_TIMEOUT',
              sessionId
            }
          )
        );
      }, 15000);
    }, timeoutMs + 2000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    if (options.signal) {
      abortHandler = () => {
        if (settled) return;

        console.log('[HERMES] Cancellation requested. Stopping Hermes process.');

        try {
          child.kill('SIGTERM');
        } catch {}

        setTimeout(() => {
          try {
            if (!settled) child.kill('SIGKILL');
          } catch {}
        }, 3000);

        finish(
          reject,
          Object.assign(
            new Error('Hermes task cancelled by user.'),
            {
              code: 'HERMES_CANCELLED',
              sessionId: state.sessionId,
              events: state.events
            }
          )
        );
      };

      if (options.signal.aborted) {
        abortHandler();
      } else {
        options.signal.addEventListener('abort', abortHandler, {
          once: true
        });
      }
    }

    let stdoutBuffer = '';

    child.stdout.on('data', chunk => {
      state.stdoutChars += chunk.length;

      if (state.stdoutChars > MAX_OUTPUT_CHARS) {
        child.kill('SIGTERM');

        finish(
          reject,
          new Error(
            `Hermes output exceeded ${MAX_OUTPUT_CHARS} characters.`
          )
        );

        return;
      }

      stdoutBuffer += chunk;

      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        parseStreamJsonLine(line, state);
      }
    });

    child.stderr.on('data', chunk => {
      state.stderr += chunk;

      if (state.stderr.length > 20000) {
        state.stderr = state.stderr.slice(-20000);
      }
    });

    child.on('error', error => {
      finish(reject, error);
    });

    child.on('close', (code, signal) => {
      if (stdoutBuffer.trim()) {
        parseStreamJsonLine(stdoutBuffer, state);
      }

      if (code !== 0) {
        const message =
          state.result?.error ||
          state.result?.text ||
          state.stderr.trim() ||
          `Hermes exited with code ${code}${
            signal ? ` (${signal})` : ''
          }.`;

        /*
         * Hermes may exit non-zero when its run budget is reached.
         * If we have a session ID, expose it so askHermes can resume.
         */
        if (state.sessionId) {
          finish(
            reject,
            Object.assign(new Error(message), {
              code: 'HERMES_TIMEOUT',
              sessionId: state.sessionId,
              events: state.events
            })
          );
        } else {
          finish(reject, new Error(message));
        }

        return;
      }

      finish(resolve, {
        ok: true,
        text: state.text.trim(),
        result: state.result,
        events: state.events,
        sessionId:
          state.sessionId ||
          state.result?.session_id ||
          null
      });
    });
  });
}

async function askHermes(query, options = {}) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('Hermes query must be a non-empty string.');
  }

  const timeoutMs = Number(
    options.timeoutMs || DEFAULT_TIMEOUT_MS
  );

  const maxContinuations = Math.max(
    0,
    Number(
      options.maxContinuations ??
        DEFAULT_MAX_CONTINUATIONS
    )
  );

  let currentQuery = query;
  let resumeSessionId = null;
  let continuationCount = 0;
  let allEvents = [];

  while (true) {
    try {
      const result = await runHermesOnce(currentQuery, {
        ...options,
        timeoutMs,
        resumeSessionId
      });

      return {
        ...result,
        events: allEvents.concat(result.events || []),
        continuationCount,
        sessionId:
          result.sessionId ||
          resumeSessionId ||
          null
      };
    } catch (error) {
      allEvents = allEvents.concat(error.events || []);

      if (error.code === 'HERMES_CANCELLED') {
        throw error;
      }

      if (
        error.code !== 'HERMES_TIMEOUT' ||
        continuationCount >= maxContinuations ||
        !error.sessionId
      ) {
        throw error;
      }

      continuationCount += 1;
      resumeSessionId = error.sessionId;

      console.log(
        `[HERMES] Timeout limit reached — reconnecting session ` +
        `${resumeSessionId} ` +
        `(continuation ${continuationCount}/${maxContinuations}).`
      );

      currentQuery =
        'Continue the previous task from exactly where you stopped. ' +
        'Do not restart the task or repeat completed work. ' +
        'Continue working toward the original user request and finish it.';
    }
  }
}

module.exports = {
  askHermes,
  HERMES_BIN
};
