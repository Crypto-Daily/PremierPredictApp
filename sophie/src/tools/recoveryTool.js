'use strict';
const { classifyError } = require('../nexus/recovery');
const { resumeWorkflow, pauseForApproval } = require('../nexus/workflowRecovery');
module.exports = {
  name: 'recovery',
  description: 'Classify recoverable failures and resume or pause persisted workflows.',
  capabilities: ['recovery'],
  risk: 'medium',
  async execute({ action = 'classify', error, taskId, reason } = {}) {
    if (action === 'classify') return { ok: true, decision: classifyError(error) };
    if (action === 'resume') return { ok: true, task: resumeWorkflow(taskId) };
    throw new Error('Approval-required workflow pausing must be performed by the orchestrator.');
  }
};
