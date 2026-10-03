'use strict';
const { adaptPlan } = require('../nexus/adaptivePlanner');
module.exports = {
  name: 'planner',
  description: 'Adapt an active workflow from observations and failures.',
  capabilities: ['planning'],
  risk: 'medium',
  async execute({ task, observation, error } = {}) {
    return { ok: true, ...adaptPlan({ task, observation, error }) };
  }
};
