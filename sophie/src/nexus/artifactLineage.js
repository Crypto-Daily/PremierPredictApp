'use strict';

const crypto = require('node:crypto');

function fingerprint(artifact) {
  return crypto.createHash('sha256').update(JSON.stringify({
    path: artifact?.path || '',
    size: artifact?.size || 0,
    modifiedAt: artifact?.modifiedAt || ''
  })).digest('hex');
}

function recordArtifact({ taskId, artifact, action = 'created', parentId = null } = {}) {
  return {
    id: crypto.randomUUID(),
    taskId,
    parentId,
    action,
    artifact: { ...artifact, fingerprint: fingerprint(artifact) },
    at: new Date().toISOString()
  };
}

function buildLineage(records = []) {
  const byParent = new Map();
  for (const record of records) {
    const key = record.parentId || 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(record);
  }
  return [...byParent.entries()].map(([parentId, children]) => ({ parentId, children }));
}

module.exports = { fingerprint, recordArtifact, buildLineage };
