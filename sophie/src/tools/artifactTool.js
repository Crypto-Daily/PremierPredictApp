'use strict';

const { listArtifacts, resolveArtifact } = require('../core/artifactManager');
const { writeArtifact, validateArtifact } = require('../nexus/artifactWriter');

module.exports = {
  name: 'artifact',
  description: 'Inspect, create and validate supported artifacts in Sophie workspace.',
  capabilities: ['artifacts'],
  risk: 'medium',
  async execute({ action = 'list', path: artifactPath, name, content } = {}) {
    if (action === 'list') return { ok: true, artifacts: listArtifacts() };
    if (action === 'resolve') return { ok: true, path: resolveArtifact(artifactPath) };
    if (action === 'write') return writeArtifact({ name, content });
    if (action === 'validate') return validateArtifact(name || artifactPath);
    throw new Error('Unsupported artifact action.');
  }
};
