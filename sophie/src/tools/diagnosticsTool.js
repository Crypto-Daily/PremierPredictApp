'use strict';

const diagnostics = require('../server/diagnostics');

module.exports = {
  name: 'diagnostics',
  description: 'Inspect Sophie runtime and provider health without exposing secrets.',
  capabilities: ['diagnostics'],
  risk: 'low',
  async execute({ provider } = {}) {
    return {
      ok: true,
      health: provider ? diagnostics.providerSnapshot(provider) : diagnostics.snapshot()
    };
  }
};
