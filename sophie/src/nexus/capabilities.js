'use strict';

const CAPABILITIES = Object.freeze({
  research: { tools: ['web_search'], risk: 'medium' },
  vision: { tools: ['vision', 'ask_hermes'], risk: 'medium' },
  documents: { tools: ['artifact', 'ask_hermes'], risk: 'medium' },
  code: { tools: ['ask_hermes'], risk: 'high' },
  computer: { tools: ['ask_hermes'], risk: 'high' },
  memory: { tools: ['memory'], risk: 'low' },
  artifacts: { tools: ['artifact'], risk: 'medium' }
});

function capabilityForIntent(intent) {
  if (intent === 'WEB_RESEARCH') return 'research';
  if (intent === 'VISION') return 'vision';
  if (intent === 'CREATION') return 'artifacts';
  if (intent === 'DEVICE_CONTROL') return 'computer';
  return 'code';
}

function describeCapabilities() {
  return Object.entries(CAPABILITIES).map(([name, value]) => ({ name, ...value }));
}

module.exports = { CAPABILITIES, capabilityForIntent, describeCapabilities };
