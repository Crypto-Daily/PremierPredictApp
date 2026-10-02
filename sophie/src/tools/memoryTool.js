'use strict';

const Memory = require('../memory/memory');
const { retrieveRelevant } = require('../nexus/memoryIndex');

const memory = new Memory();

module.exports = {
  name: 'memory',
  description: 'Retrieve relevant long-term facts and conversation context.',
  capabilities: ['memory'],
  risk: 'low',
  async execute({ query, limit = 8 } = {}) {
    const facts = memory.getFacts();
    const messages = memory.getRecentMessages(40);
    return { ok: true, results: retrieveRelevant(facts, messages, query, limit) };
  }
};
