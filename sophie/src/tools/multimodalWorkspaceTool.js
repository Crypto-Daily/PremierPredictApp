'use strict';
const { inspectWorkspace, buildEvidenceBundle } = require('../nexus/multimodalWorkspace');
module.exports = {
  name: 'multimodal_workspace',
  description: 'Inspect workspace artifacts and build a bounded evidence bundle.',
  capabilities: ['documents','vision','data'],
  risk: 'medium',
  async execute({ action = 'inspect', paths = [], items = [] } = {}) {
    if (action === 'evidence_bundle') return { ok: true, bundle: buildEvidenceBundle(items) };
    return { ok: true, artifacts: inspectWorkspace({ paths }) };
  }
};
