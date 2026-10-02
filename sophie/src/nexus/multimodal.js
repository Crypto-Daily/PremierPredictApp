'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveArtifact } = require('../core/artifactManager');

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
  '.csv': 'text/csv', '.json': 'application/json'
};

function classifyFile(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (/\.(png|jpe?g|webp|gif)$/i.test(ext)) return 'image';
  if (/\.(pdf|txt|md|csv|json|docx|xlsx|pptx)$/i.test(ext)) return 'document';
  if (/\.(mp3|wav|m4a|ogg|webm)$/i.test(ext)) return 'audio';
  return 'unknown';
}

function readStructuredFile(filePath, maxBytes = 2_000_000) {
  const resolved = resolveArtifact(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error('Artifact is not a file.');
  if (stat.size > maxBytes) throw new Error('Artifact exceeds the analysis size limit.');

  const ext = path.extname(resolved).toLowerCase();
  if (!['.txt', '.md', '.csv', '.json'].includes(ext)) {
    return { path: resolved, type: classifyFile(resolved), binary: true, size: stat.size };
  }

  const text = fs.readFileSync(resolved, 'utf8');
  return {
    path: resolved,
    type: classifyFile(resolved),
    mime: MIME[ext] || 'application/octet-stream',
    text: text.slice(0, maxBytes),
    truncated: text.length > maxBytes,
    size: stat.size
  };
}

function summarizeTable(text, delimiter = ',') {
  const rows = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (!rows.length) return { rows: 0, columns: 0, headers: [] };
  const columns = rows.map(row => row.split(delimiter).length);
  return {
    rows: rows.length,
    columns: Math.max(...columns),
    headers: rows[0].split(delimiter).map(x => x.trim()).slice(0, 50)
  };
}

module.exports = { classifyFile, readStructuredFile, summarizeTable, MIME };
