const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ROOT = path.join(PROJECT_ROOT, 'src');
const BACKUP_ROOT = path.join(PROJECT_ROOT, 'backups', 'self-upgrade');

const BLOCKED = [
  /^\.env/i,
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)backups(\/|$)/i,
  /(^|\/)data(\/|$)/i,
  /(^|\/)logs(\/|$)/i,
  /(^|\/)workspace(\/|$)/i
];

function normalizeProjectPath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('A file path is required');
  }

  const cleaned = filePath.trim().replace(/\\/g, '/');
  const absolute = path.resolve(PROJECT_ROOT, cleaned);
  const relative = path.relative(PROJECT_ROOT, absolute);

  if (
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    !absolute.startsWith(`${SRC_ROOT}${path.sep}`)
  ) {
    throw new Error('Self-upgrade writes are restricted to src/');
  }

  if (BLOCKED.some(pattern => pattern.test(relative))) {
    throw new Error(`Blocked path: ${relative}`);
  }

  return {
    absolute,
    relative: relative.replace(/\\/g, '/')
  };
}

function ensureBackupDir() {
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function run(command, options = {}) {
  return cp.execSync(command, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout || 30000,
    maxBuffer: 2 * 1024 * 1024
  }).trim();
}

function syntaxCheck(absolutePath) {
  if (!absolutePath.endsWith('.js')) {
    return { ok: true, skipped: true };
  }

  try {
    run(`node --check ${JSON.stringify(absolutePath)}`, {
      timeout: 15000
    });

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `${error.stdout || ''}${error.stderr || ''}`.trim() ||
        error.message
    };
  }
}

function backupFiles(paths) {
  ensureBackupDir();

  const backupDir = path.join(BACKUP_ROOT, timestamp());
  fs.mkdirSync(backupDir, { recursive: true });

  const records = [];

  for (const item of paths) {
    const { absolute, relative } = normalizeProjectPath(item.path);

    if (!fs.existsSync(absolute)) {
      records.push({
        path: relative,
        existed: false,
        backupPath: null
      });
      continue;
    }

    const destination = path.join(
      backupDir,
      relative.replace(/[\/\\]/g, '__')
    );

    fs.copyFileSync(absolute, destination);

    records.push({
      path: relative,
      existed: true,
      backupPath: destination
    });
  }

  return {
    backupDir,
    records
  };
}

function restoreBackup(backup) {
  for (const record of backup.records) {
    const { absolute } = normalizeProjectPath(record.path);

    if (record.existed) {
      fs.copyFileSync(record.backupPath, absolute);
    } else if (fs.existsSync(absolute)) {
      fs.unlinkSync(absolute);
    }
  }
}

function writeFiles(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error('No file changes supplied');
  }

  const normalized = changes.map(change => {
    if (!change || typeof change.content !== 'string') {
      throw new Error('Every change must contain string content');
    }

    const resolved = normalizeProjectPath(change.path);

    return {
      ...change,
      path: resolved.relative,
      absolute: resolved.absolute
    };
  });

  const backup = backupFiles(normalized);

  try {
    for (const change of normalized) {
      fs.mkdirSync(path.dirname(change.absolute), { recursive: true });

      const temporary = `${change.absolute}.self-upgrade.tmp`;

      fs.writeFileSync(
        temporary,
        change.content,
        'utf8'
      );

      fs.renameSync(
        temporary,
        change.absolute
      );
    }

    const syntaxResults = normalized.map(change => ({
      path: change.path,
      ...syntaxCheck(change.absolute)
    }));

    const failed = syntaxResults.find(result => !result.ok);

    if (failed) {
      restoreBackup(backup);

      throw new Error(
        `Syntax validation failed for ${failed.path}: ${failed.error}`
      );
    }

    return {
      ok: true,
      changed: normalized.map(change => change.path),
      backupDir: path.relative(PROJECT_ROOT, backup.backupDir),
      syntax: syntaxResults
    };

  } catch (error) {
    try {
      restoreBackup(backup);
    } catch (restoreError) {
      error.message += ` | ROLLBACK ERROR: ${restoreError.message}`;
    }

    throw error;
  }
}

function gitStatus() {
  try {
    return run('git status --short', { timeout: 15000 });
  } catch (error) {
    return `git status unavailable: ${error.message}`;
  }
}

function gitCheckpoint(message = 'Sophie self-upgrade checkpoint') {
  try {
    const status = gitStatus();

    if (!status.trim()) {
      return {
        ok: true,
        changed: false,
        message: 'No Git changes to checkpoint.'
      };
    }

    run('git add src package.json package-lock.json 2>/dev/null || git add src');

    const safeMessage = message
      .replace(/[^a-zA-Z0-9 _.-]/g, '')
      .trim()
      .slice(0, 120) || 'Sophie self-upgrade';

    run(`git commit -m ${JSON.stringify(safeMessage)}`, {
      timeout: 30000
    });

    return {
      ok: true,
      changed: true,
      commit: run('git rev-parse --short HEAD', { timeout: 15000 })
    };

  } catch (error) {
    return {
      ok: false,
      error: `${error.stdout || ''}${error.stderr || ''}`.trim() ||
        error.message
    };
  }
}

function validateProject() {
  const files = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === 'backups'
      ) {
        continue;
      }

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        files.push(full);
      }
    }
  }

  walk(SRC_ROOT);

  const results = files.map(file => ({
    path: path.relative(PROJECT_ROOT, file),
    ...syntaxCheck(file)
  }));

  const failures = results.filter(result => !result.ok);

  return {
    ok: failures.length === 0,
    checked: results.length,
    failures,
    results
  };
}

function healthCheck() {
  return new Promise(resolve => {
    const http = require('http');
    const port = Number(process.env.PORT) || 3000;

    const request = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/status',
        timeout: 10000
      },
      response => {
        let data = '';

        response.on('data', chunk => {
          data += chunk;
        });

        response.on('end', () => {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            statusCode: response.statusCode,
            body: data.slice(0, 4000)
          });
        });
      }
    );

    request.on('timeout', () => {
      request.destroy();

      resolve({
        ok: false,
        error: 'Health check timed out'
      });
    });

    request.on('error', error => {
      resolve({
        ok: false,
        error: error.message
      });
    });
  });
}

function restartSophie() {
  try {
    const output = run(
      'pm2 restart sophie --update-env',
      { timeout: 30000 }
    );

    return {
      ok: true,
      output
    };
  } catch (error) {
    return {
      ok: false,
      error: `${error.stdout || ''}${error.stderr || ''}`.trim() ||
        error.message
    };
  }
}

/*
 * Main controlled upgrade operation.
 *
 * It intentionally accepts already-generated file changes instead of
 * executing arbitrary shell commands generated by an AI model.
 */
async function applyUpgrade({
  changes,
  checkpoint = true,
  restart = false,
  checkpointMessage = 'Sophie self-upgrade'
}) {
  const validationBefore = validateProject();

  if (!validationBefore.ok) {
    return {
      ok: false,
      stage: 'pre-validation',
      validation: validationBefore
    };
  }

  let writeResult;

  try {
    writeResult = writeFiles(changes);
  } catch (error) {
    return {
      ok: false,
      stage: 'write',
      error: error.message
    };
  }

  const validationAfter = validateProject();

  if (!validationAfter.ok) {
    return {
      ok: false,
      stage: 'post-validation',
      validation: validationAfter
    };
  }

  let checkpointResult = null;

  if (checkpoint) {
    checkpointResult = gitCheckpoint(checkpointMessage);
  }

  let restartResult = null;
  let health = null;

  if (restart) {
    restartResult = restartSophie();

    if (restartResult.ok) {
      await new Promise(resolve => setTimeout(resolve, 2500));
      health = await healthCheck();

      if (!health.ok) {
        return {
          ok: false,
          stage: 'health-check',
          changed: writeResult.changed,
          backupDir: writeResult.backupDir,
          checkpoint: checkpointResult,
          restart: restartResult,
          health
        };
      }
    }
  }

  return {
    ok: true,
    stage: 'complete',
    changed: writeResult.changed,
    backupDir: writeResult.backupDir,
    syntax: writeResult.syntax,
    checkpoint: checkpointResult,
    restart: restartResult,
    health
  };
}

module.exports = {
  normalizeProjectPath,
  validateProject,
  healthCheck,
  gitStatus,
  gitCheckpoint,
  applyUpgrade
};
