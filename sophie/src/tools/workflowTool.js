'use strict';

const { startWorkflow, checkpointWorkflow, verifyWorkflow } = require('../nexus/workflowComposer');

module.exports = {
  name: 'workflow',
  description: 'Compose and persist multi-stage NEXUS workflows.',
  capabilities: ['workflow'],
  risk: 'medium',
  async execute({ action = 'start', command, intent, mode, task, stage, data, response, evidence, requirements, artifacts } = {}) {
    if (action === 'start') return { ok: true, task: startWorkflow({ command, intent, mode }) };
    if (action === 'checkpoint') return { ok: true, task: checkpointWorkflow(task, stage, data) };
    if (action === 'verify') return verifyWorkflow({ response, evidence, requirements, artifacts });
    throw new Error('Unsupported workflow action.');
  }
};
