'use strict';

const { containsInjection, capabilityPolicy, sanitizeExternalContent } = require('./policy');
const { buildContext, compactContext } = require('./context');
const { verifyResponse } = require('./verification');

function determinePlan({ intent, command, mode }) {
  const current = String(command || '');
  const needsCurrent = /\b(latest|today|current|currently|recent|breaking|price|weather|score|schedule|status)\b/i.test(current);
  const needsExecution = /\b(create|make|build|write|edit|run|execute|install|debug|test|browse|open|download|upload|send|control)\b/i.test(current);

  return {
    objective: current,
    steps: [
      'UNDERSTAND',
      intent === 'CHAT' ? 'REASON' : 'DECOMPOSE',
      needsCurrent ? 'RETRIEVE' : null,
      needsExecution ? 'EXECUTE' : null,
      'OBSERVE',
      'VERIFY',
      'SYNTHESIZE',
      'DELIVER'
    ].filter(Boolean),
    mode,
    currentInformationRequired: needsCurrent,
    executionRequired: needsExecution
  };
}

function prepareRequest({ command, intent, mode, memoryFacts, conversation, research, timeContext }) {
  const injection = containsInjection(command);
  const plan = determinePlan({ intent, command, mode });
  const context = compactContext(buildContext({
    objective: command,
    memoryFacts,
    conversation,
    research,
    timeContext
  }));

  return {
    plan,
    context,
    security: {
      promptInjectionDetected: injection,
      externalContentIsData: true,
      credentialsForwarded: false
    }
  };
}

function authorizeCapability(capability, options = {}) {
  return capabilityPolicy({
    capability,
    available: options.available !== false,
    authorized: options.authorized === true
  });
}

function finalize({ response, execution = null, evidence = [], requirements = [] }) {
  const verification = verifyResponse({
    text: response,
    execution,
    evidence,
    requirements
  });

  return {
    text: response,
    verification,
    claimPolicy: 'Separate verified facts, calculations, retrieval, reasoning, assumptions and uncertainty.'
  };
}

function researchItem(text, source) {
  return sanitizeExternalContent(text, source);
}

module.exports = {
  determinePlan,
  prepareRequest,
  authorizeCapability,
  finalize,
  researchItem
};
