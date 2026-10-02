'use strict';

const { classifyFile, readStructuredFile, summarizeTable } = require('../nexus/multimodal');

module.exports = {
  name: 'multimodal',
  description: 'Classify and inspect supported image, document, audio and structured-data artifacts.',
  capabilities: ['vision', 'documents', 'data'],
  risk: 'medium',
  async execute({ action = 'inspect', path: artifactPath } = {}) {
    if (!artifactPath) throw new Error('Artifact path is required.');
    const info = readStructuredFile(artifactPath);

    if (action === 'table_summary' && info.text) {
      return { ok: true, path: info.path, type: info.type, summary: summarizeTable(info.text) };
    }

    return {
      ok: true,
      path: info.path,
      type: info.type || classifyFile(info.path),
      mime: info.mime || null,
      size: info.size,
      text: info.text,
      binary: info.binary || false,
      truncated: Boolean(info.truncated)
    };
  }
};
