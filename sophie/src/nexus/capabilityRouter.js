'use strict';

const { getTool } = require('../tools');

const INTENT_CAPABILITY = {
  VISION: 'vision',
  CREATION: 'artifacts',
  WEB_RESEARCH: 'research',
  DEVICE_CONTROL: 'computer',
  MEMORY: 'memory'
};

function requiredCapabilities({ intent = 'CHAT', command = '' } = {}) {
  const result = new Set();
  if (INTENT_CAPABILITY[intent]) result.add(INTENT_CAPABILITY[intent]);
  const text = String(command).toLowerCase();
  if (/\b(csv|spreadsheet|dataset|data|table|excel|json)\b/.test(text)) result.add('data');
  if (/\b(pdf|document|docx|report|paper)\b/.test(text)) result.add('documents');
  if (/\b(image|photo|picture|screenshot|visual)\b/.test(text)) result.add('vision');
  if (/\b(audio|voice|recording|sound)\b/.test(text)) result.add('audio');
  if (/\b(code|script|program|debug|test)\b/.test(text)) result.add('code');
  return [...result];
}

function resolveCapabilityTools(args = {}) {
  return requiredCapabilities(args).map(capability => {
    const candidates = {
      data: ['multimodal', 'ask_hermes'],
      documents: ['multimodal', 'ask_hermes'],
      vision: ['vision', 'multimodal', 'ask_hermes'],
      audio: ['ask_hermes'],
      code: ['ask_hermes'],
      research: ['web_search', 'ask_hermes'],
      artifacts: ['artifact', 'ask_hermes'],
      computer: ['ask_hermes'],
      memory: ['memory']
    }[capability] || [];
    const available = candidates.filter(name => getTool(name));
    return { capability, tools: available };
  });
}

module.exports = { requiredCapabilities, resolveCapabilityTools };
