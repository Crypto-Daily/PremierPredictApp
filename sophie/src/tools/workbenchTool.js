'use strict';

const { resolveArtifact } = require('../core/artifactManager');
const fs = require('node:fs');
const { analyzeCsv } = require('../nexus/dataWorkbench');

module.exports = {
  name: 'workbench',
  description: 'Analyze structured datasets inside the Sophie workspace.',
  capabilities: ['data'],
  risk: 'medium',
  async execute({ action, path: artifactPath } = {}) {
    if (action === 'analyze_csv') {
      const file = resolveArtifact(artifactPath);
      const text = fs.readFileSync(file, 'utf8');
      return { ok: true, analysis: analyzeCsv(text) };
    }
    throw new Error('Unsupported workbench action.');
  }
};
