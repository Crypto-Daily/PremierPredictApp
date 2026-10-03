'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveArtifact } = require('../core/artifactManager');
const { execFileSync } = require('node:child_process');

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
  '.csv': 'text/csv', '.json': 'application/json', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pdf': 'application/pdf'
};

function classifyFile(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (/\.(png|jpe?g|webp|gif)$/i.test(ext)) return 'image';
  if (/\.(pdf|txt|md|csv|json|docx|xlsx|pptx)$/i.test(ext)) return 'document';
  if (/\.(mp3|wav|m4a|ogg|webm)$/i.test(ext)) return 'audio';
  return 'unknown';
}

function extractOfficeXml(resolved, ext) {
  const entries = {
    '.docx': ['word/document.xml', 'word/header1.xml', 'word/footer1.xml'],
    '.xlsx': ['xl/sharedStrings.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'],
    '.pptx': ['ppt/presentation.xml', 'ppt/slides/slide1.xml']
  }[ext];
  if (!entries) return null;
  try {
    const chunks = entries.map(entry => {
      try { return execFileSync('unzip', ['-p', resolved, entry], { encoding: 'utf8', timeout: 5000, maxBuffer: 5 * 1024 * 1024 }); }
      catch { return ''; }
    }).filter(Boolean);
    if (!chunks.length) return null;
    return chunks.join('\n').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\\s+/g, ' ').trim();
  } catch { return null; }
}

function extractPdf(resolved, maxBytes) {
  try {
    return execFileSync('pdftotext', ['-layout', resolved, '-'], { encoding: 'utf8', timeout: 10000, maxBuffer: maxBytes }).slice(0, maxBytes);
  } catch { return null; }
}

function readStructuredFile(filePath, maxBytes = 2_000_000) {
  const resolved = resolveArtifact(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error('Artifact is not a file.');
  if (stat.size > maxBytes) throw new Error('Artifact exceeds the analysis size limit.');

  const ext = path.extname(resolved).toLowerCase();
  if (!['.txt', '.md', '.csv', '.json'].includes(ext)) {
    const extracted = ext === '.pdf' ? extractPdf(resolved, maxBytes) : extractOfficeXml(resolved, ext);
    return { path: resolved, type: classifyFile(resolved), mime: MIME[ext] || null, binary: !extracted, size: stat.size, text: extracted || undefined, extracted: Boolean(extracted) };
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
