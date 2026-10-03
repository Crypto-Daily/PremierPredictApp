'use strict';

const { decomposeTask } = require('./autonomy');
const { classifyError } = require('./recovery');

function scoreObservation(observation = {}) {
  const text = JSON.stringify(observation).toLowerCase();
  if (observation.ok === false) return text.includes('transient') || text.includes('timeout') ? 'retry' : 'replan';
  if (observation.verified === false) return 'replan';
  if (text.includes('missing') || text.includes('insufficient evidence')) return 'retrieve_more';
  return 'continue';
}

function adaptPlan({ task, observation = {}, error } = {}) {
  if (!task?.workflow) throw new Error('Workflow state is required.');
  const decision = error ? classifyError(error) : { kind: 'observation', recoverable: false };
  const action = error ? (decision.recoverable ? 'retry' : 'approval') : scoreObservation(observation);
  const plan = task.workflow.sourcePlan || decomposeTask(task);

  if (action === 'approval') {
    return { action, reason: decision.kind, workflow: { ...task.workflow, adaptive: { action, at: new Date().toISOString() } } };
  }

  if (action === 'retrieve_more') {
    const stages = task.workflow.stages.some(s => s.id === 'retrieve')
      ? task.workflow.stages
      : [{ id: 'retrieve', action: 'retrieve_additional_evidence', checkpoint: true }, ...task.workflow.stages];
    return { action, workflow: { ...task.workflow, stages, adaptive: { action, at: new Date().toISOString() } } };
  }

  if (action === 'replan') {
    const revised = decomposeTask({ command: task.objective, intent: task.intent, mode: task.mode });
    return { action, workflow: { ...task.workflow, sourcePlan: revised, adaptive: { action, at: new Date().toISOString() } } };
  }

  return { action, workflow: { ...task.workflow, adaptive: { action, at: new Date().toISOString() }, sourcePlan: plan } };
}

module.exports = { scoreObservation, adaptPlan };
