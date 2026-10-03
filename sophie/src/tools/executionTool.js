'use strict';
const { executeLoop } = require('../nexus/executionLoop');
module.exports = {
  name: 'execution',
  description: 'Run a bounded observe-act-verify-correct loop with task checkpoints.',
  capabilities: ['execution'],
  risk: 'medium',
  async execute(args = {}) { return executeLoop(args); }
};
