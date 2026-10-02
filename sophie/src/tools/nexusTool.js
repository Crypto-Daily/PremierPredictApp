'use strict';

const { buildToolPlan } = require('../nexus/toolRouter');

module.exports = {
  name: 'nexus_plan',
  description: 'Build a capability-aware NEXUS tool plan without executing tools.',
  async execute({ command, intent = 'CHAT', mode = 'GPT' } = {}) {
    return {
      response: JSON.stringify(buildToolPlan({ command, intent, mode }), null, 2)
    };
  }
};
