const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SOPHIE_SRC_ROOT = path.join(PROJECT_ROOT, 'src');
const BACKUP_ROOT = path.join(PROJECT_ROOT, 'backups');

function checkPasscode(passcode) {
  const real = process.env.SOPHIE_ADMIN_PASSCODE;

  if (!real) {
    throw new Error('No admin passcode is configured (SOPHIE_ADMIN_PASSCODE missing from .env)');
  }

  if (passcode !== real) {
    throw new Error('Incorrect passcode');
  }
}

function resolveSafe(relativePath) {
  const resolved = path.resolve(PROJECT_ROOT, relativePath);

  if (!resolved.startsWith(SOPHIE_SRC_ROOT)) {
    throw new Error('Access denied: writes are only allowed inside src/');
  }

  return resolved;
}

// Copies the existing file into backups/ with a timestamp before it's
// overwritten. Returns null for a brand-new file (nothing to back up).
function backupFile(resolved, relativePath) {
  if (!fs.existsSync(resolved)) return null;

  if (!fs.existsSync(BACKUP_ROOT)) {
    fs.mkdirSync(BACKUP_ROOT, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const flatName = relativePath.replace(/[\/\\]/g, '__');
  const backupPath = path.join(BACKUP_ROOT, `${flatName}.${timestamp}.bak`);

  fs.copyFileSync(resolved, backupPath);

  return backupPath;
}

function writeProjectFile(relativePath, content, passcode) {
  checkPasscode(passcode);

  const resolved = resolveSafe(relativePath);
  const backupPath = backupFile(resolved, relativePath);

  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(resolved, content, 'utf8');

  return {
    path: relativePath,
    bytesWritten: Buffer.byteLength(content, 'utf8'),
    backupPath: backupPath ? path.relative(PROJECT_ROOT, backupPath) : null
  };
}

module.exports = {
  writeProjectFile
};
