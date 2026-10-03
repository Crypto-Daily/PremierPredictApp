'use strict';

const { getTool, listTools } = require('../tools/toolRegistry');
const { authorizeCapability } = require('./orchestrator');
const { capabilityForIntent } = require('./capabilities');

const TOOL_INTENTS = {
  WEB_RESEARCH: ['web_search', 'ask_hermes'],
  VISION: ['vision', 'ask_hermes'],
  CREATION: ['artifact', 'ask_hermes'],
  DEVICE_CONTROL: ['ask_hermes'],
  SELF_INSPECT: ['self_inspect'],
  CHAT: ['ask_hermes']
};

function availableTools() {
  return listTools().map(t => t.name);
}

function selectTools({ intent = 'CHAT', mode = 'GPT', command = '' } = {}) {
  const capability = capabilityForIntent(intent);
  const names = TOOL_INTENTS[intent] || TOOL_INTENTS.CHAT;
  const selected = names.filter(name => getTool(name));
  if (mode === 'JARVIS' && getTool('ask_hermes') && !selected.includes('ask_hermes')) {
    selected.push('ask_hermes');
  }

  const lower = String(command).toLowerCase();
  if (/\b(file|folder|directory|code|repository|repo)\b/.test(lower) && getTool('ask_hermes') && !selected.includes('ask_hermes')) {
    selected.push('ask_hermes');
  }

  return selected.map(name => ({
    capability,
    name,
    authorized: authorizeCapability(name, { available: true, authorized: true }).allowed
  }));
}

function buildToolPlan(args = {}) {
  const selected = selectTools(args);
  return {
    availableTools: availableTools(),
    selectedTools: selected,
    fallback: selected.length === 0 ? 'provider' : 'selected-tool',
    toolCount: selected.length
  };
}

module.exports = { availableTools, selectTools, buildToolPlan };
