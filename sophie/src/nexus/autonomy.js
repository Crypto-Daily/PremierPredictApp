'use strict';

const { requiredCapabilities, resolveCapabilityTools } = require('./capabilityRouter');
const { createTaskState, transition } = require('./taskState');

function decomposeTask({ command = '', intent = 'CHAT', mode = 'GPT' } = {}) {
  const capabilities = requiredCapabilities({ command, intent });
  const toolRoutes = resolveCapabilityTools({ command, intent });
  const steps = [{ id: 'understand', action: 'understand_objective' }];

  if (capabilities.includes('research')) steps.push({ id: 'research', action: 'retrieve_external_evidence' });
  if (capabilities.includes('memory')) steps.push({ id: 'memory', action: 'retrieve_relevant_memory' });
  for (const route of toolRoutes) {
    if (route.tools.length) steps.push({ id: 'capability:' + route.capability, action: 'execute_capability', capability: route.capability, tools: route.tools });
  }
  steps.push({ id: 'verify', action: 'verify_result' }, { id: 'deliver', action: 'synthesize_and_deliver' });

  return { objective: command, intent, mode, capabilities, toolRoutes, steps };
}

function createAutonomousTask(args = {}) {
  const plan = decomposeTask(args);
  const state = createTaskState(args);
  return transition(state, 'planned', { plan, nextStep: plan.steps[0]?.id || null });
}

function nextStep(state) {
  const steps = state.plan?.steps || [];
  const index = steps.findIndex(step => step.id === state.currentStep || step.id === state.nextStep);
  return steps[index + 1] || null;
}

function advance(state, completedStep, data = {}) {
  const next = nextStep({ ...state, currentStep: completedStep });
  return transition(state, next ? 'running' : 'ready_to_verify', {
    ...data,
    currentStep: completedStep,
    nextStep: next?.id || null
  });
}

module.exports = { decomposeTask, createAutonomousTask, nextStep, advance };
