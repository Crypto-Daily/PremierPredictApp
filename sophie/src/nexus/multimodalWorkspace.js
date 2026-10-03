'use strict';

const { listArtifacts, resolveArtifact } = require('../core/artifactManager');
const { classifyFile, readStructuredFile } = require('./multimodal');

function inspectWorkspace({ paths = [] } = {}) {
  const targets = paths.length ? paths : listArtifacts().map(x => x.path);
  return targets.map(relative => {
    const resolved = resolveArtifact(relative);
    const data = readStructuredFile(relative);
    return {
      path: relative,
      type: classifyFile(resolved),
      mime: data.mime || null,
      size: data.size,
      textAvailable: Boolean(data.text),
      extracted: Boolean(data.extracted),
      truncated: Boolean(data.truncated)
    };
  });
}

function buildEvidenceBundle(items = []) {
  return {
    createdAt: new Date().toISOString(),
    count: items.length,
    items: items.map(item => ({
      source: item.path || item.source,
      type: item.type,
      extracted: Boolean(item.extracted || item.textAvailable),
      evidence: item.text ? String(item.text).slice(0, 10000) : undefined
    }))
  };
}

module.exports = { inspectWorkspace, buildEvidenceBundle };
