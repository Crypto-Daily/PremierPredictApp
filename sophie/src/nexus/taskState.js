'use strict';

const { randomUUID } = require('node:crypto');

function createTaskState({ command, intent, mode } = {}) {
  return {
    id: randomUUID(),
    objective: String(command || ''),
    intent: intent || 'CHAT',
    mode: mode || 'GPT',
    status: 'created',
    iteration: 0,
    steps: [],
    evidence: [],
    observations: [],
    corrections: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function transition(state, status, data = {}) {
  const next = {
    ...state,
    ...data,
    status,
    updatedAt: new Date().toISOString()
  };
  next.steps = [...(state.steps || []), { status, at: next.updatedAt }];
  return next;
}

module.exports = { createTaskState, transition };
