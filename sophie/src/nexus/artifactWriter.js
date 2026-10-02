'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { WORKSPACE_ROOT } = require('../core/artifactManager');

const ALLOWED = new Set(['.txt','.md','.json','.csv']);

function safeOutput(name) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Output filename is required.');
  const clean = path.basename(name);
  const ext = path.extname(clean).toLowerCase();
  if (clean !== name || !ALLOWED.has(ext)) throw new Error('Unsupported or unsafe output filename.');
  return path.resolve(WORKSPACE_ROOT, clean);
}

function writeArtifact({ name, content } = {}) {
  const target = safeOutput(name);
  if (typeof content !== 'string') throw new Error('Artifact content must be text.');
  if (content.length > 2_000_000) throw new Error('Artifact exceeds 2MB.');
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  return validateArtifact(name);
}

function validateArtifact(name) {
  const target = safeOutput(name);
  if (!fs.existsSync(target)) return { ok: false, error: 'Artifact was not created.' };
  const stat = fs.statSync(target);
  if (!stat.isFile() || stat.size > 2_000_000) return { ok: false, error: 'Artifact failed size/type validation.' };
  return { ok: true, name: path.basename(target), size: stat.size, extension: path.extname(target).toLowerCase() };
}

module.exports = { writeArtifact, validateArtifact };
