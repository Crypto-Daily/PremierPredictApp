'use strict';

const crypto = require('node:crypto');
const { decomposeTask } = require('./autonomy');
const { saveTask, checkpoint } = require('./workspaceState');
const { recordArtifact } = require('./artifactLineage');
const { requiredCapabilities, resolveCapabilityTools } = require('./capabilityRouter');
const { verifyResponse } = require('./verification');

const WORKFLOW_STAGES = [
  ['understand', 'understand'],
  ['retrieve', 'retrieve'],
  ['analyze', 'analyze'],
  ['execute', 'execute'],
  ['produce', 'produce'],
  ['verify', 'verify'],
  ['deliver', 'deliver']
];

function composeWorkflow({ command = '', intent = 'CHAT', mode = 'GPT' } = {}) {
  const plan = decomposeTask({ command, intent, mode });
  const capabilities = requiredCapabilities({ command, intent });
  const routes = resolveCapabilityTools({ command, intent });
  const stageIds = new Set(plan.steps.map(s => s.id));

  const stages = WORKFLOW_STAGES
    .filter(([id]) => id === 'understand' || id === 'verify' || id === 'deliver' ||
      id === 'retrieve' && (capabilities.includes('research') || capabilities.includes('memory')) ||
      id === 'analyze' && capabilities.length > 0 ||
      id === 'execute' && routes.some(r => r.tools.length) ||
      id === 'produce' && capabilities.includes('artifacts'))
    .map(([id, action]) => ({ id, action, checkpoint: true }));

  return {
    id: crypto.randomUUID(),
    objective: command,
    intent,
    mode,
    capabilities,
    routes,
    stages,
    sourcePlan: plan,
    createdAt: new Date().toISOString()
  };
}

function startWorkflow(args = {}) {
  const workflow = composeWorkflow(args);
  const task = {
    id: workflow.id,
    objective: workflow.objective,
    intent: workflow.intent,
    mode: workflow.mode,
    status: 'running',
    workflow,
    currentStep: workflow.stages[0]?.id || null,
    nextStep: workflow.stages[1]?.id || null,
    evidence: [],
    artifacts: [],
    observations: [],
    corrections: [],
    updatedAt: new Date().toISOString()
  };
  return saveTask(task);
}

function checkpointWorkflow(task, stage, data = {}) {
  return checkpoint(task, stage, {
    workflowStage: stage,
    ...data
  });
}

function attachArtifact(task, artifact, action = 'created', parentId = null) {
  const record = recordArtifact({ taskId: task.id, artifact, action, parentId });
  const artifacts = [...(task.artifacts || []), record];
  return saveTask({ ...task, artifacts, updatedAt: new Date().toISOString() });
}

function verifyWorkflow({ response, evidence = [], requirements = [], artifacts = [] } = {}) {
  const responseCheck = verifyResponse({ text: response, evidence, requirements });
  const artifactChecks = artifacts.map(a => ({
    artifact: a,
    valid: Boolean(a?.path && Number(a?.size ?? 0) >= 0)
  }));
  return {
    ok: responseCheck.ok && artifactChecks.every(x => x.valid),
    response: responseCheck,
    artifacts: artifactChecks,
    verifiedAt: new Date().toISOString()
  };
}

module.exports = { composeWorkflow, startWorkflow, checkpointWorkflow, attachArtifact, verifyWorkflow };
