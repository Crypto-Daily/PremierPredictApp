'use strict';

const { listArtifacts, resolveArtifact } = require('../core/artifactManager');

module.exports = {
  name: 'artifact',
  description: 'Inspect artifacts in Sophie workspace and resolve safe artifact paths.',
  capabilities: ['artifacts'],
  risk: 'medium',
  async execute({ action = 'list', path: artifactPath } = {}) {
    if (action === 'list') return { ok: true, artifacts: listArtifacts() };
    if (action === 'resolve') return { ok: true, path: resolveArtifact(artifactPath) };
    throw new Error('Unsupported artifact action.');
  }
};
