'use strict';

const { research } = require('../nexus/researchEngine');

module.exports = {
  name: 'web_search',
  description: 'Search the web and return sanitized external evidence for synthesis.',
  capabilities: ['web'],
  risk: 'medium',
  async execute({ query, limit = 6 } = {}) {
    const results = await research(query, { limit });
    return { ok: true, results };
  }
};
