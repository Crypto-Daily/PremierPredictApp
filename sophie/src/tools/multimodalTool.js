'use strict';

const { classifyFile, readStructuredFile, summarizeTable } = require('../nexus/multimodal');
const { analyzeArtifact } = require('../nexus/providerMultimodal');

module.exports = {
  name: 'multimodal',
  description: 'Classify, inspect and analyze supported image, document, audio and structured-data artifacts.',
  capabilities: ['vision', 'documents', 'data', 'audio'],
  risk: 'medium',
  async execute({ action = 'inspect', path: artifactPath, objective } = {}) {
    if (!artifactPath) throw new Error('Artifact path is required.');
    if (action === 'analyze') return analyzeArtifact({ artifactPath, objective });
    const info = readStructuredFile(artifactPath);
    if (action === 'table_summary' && info.text) return { ok: true, path: info.path, type: info.type, summary: summarizeTable(info.text) };
    return { ok: true, path: info.path, type: info.type || classifyFile(info.path), mime: info.mime || null, size: info.size, text: info.text, binary: info.binary || false, truncated: Boolean(info.truncated) };
  }
};
