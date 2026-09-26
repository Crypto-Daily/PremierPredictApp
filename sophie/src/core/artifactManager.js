'use strict';

const fs = require('node:fs');
const path = require('node:path');

const WORKSPACE_ROOT = path.resolve(process.env.SOPHIE_WORKSPACE || path.join(process.cwd(), 'workspace'));

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip'
};

function ensureWorkspace() { fs.mkdirSync(WORKSPACE_ROOT, { recursive: true }); }

function safePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) throw new Error('Artifact path is required.');
  const candidate = path.resolve(WORKSPACE_ROOT, relativePath);
  const relative = path.relative(WORKSPACE_ROOT, candidate);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Artifact path is outside the Sophie workspace.');
  }
  return candidate;
}

function relativePath(filePath) { return path.relative(WORKSPACE_ROOT, filePath).split(path.sep).join('/'); }

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, results);
    else if (entry.isFile()) {
      const stat = fs.statSync(full);
      results.push({ path: relativePath(full), size: stat.size, modifiedAt: stat.mtime.toISOString(), mimeType: MIME_TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    }
  }
  return results;
}

function listArtifacts() { ensureWorkspace(); return walk(WORKSPACE_ROOT).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)); }
function snapshot() { return new Map(listArtifacts().map(file => [file.path, file.size + ':' + file.modifiedAt])); }
function diff(before) {
  return listArtifacts().filter(file => {
    const previous = before && before.get(file.path);
    return !previous || previous !== file.size + ':' + file.modifiedAt;
  });
}
function resolveArtifact(relative) {
  const fullPath = safePath(relative);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) throw new Error('Artifact does not exist.');
  return fullPath;
}

module.exports = { WORKSPACE_ROOT, listArtifacts, snapshot, diff, resolveArtifact };
