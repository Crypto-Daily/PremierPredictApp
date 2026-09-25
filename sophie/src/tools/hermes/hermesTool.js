'use strict';

const { askHermes } = require('./hermesClient');

const hermesTool = {
  name: 'ask_hermes',

  description:
    'Delegate a task to the locally installed Hermes Agent. Hermes may use its own configured tools and skills.',

  async execute(input, options = {}) {
    const query =
      typeof input === 'string'
        ? input
        : input?.query;

    if (!query || !query.trim()) {
      throw new Error('ask_hermes requires a query.');
    }

    const hermesOptions = {
      cwd: options.cwd
    };

    if (options.timeoutMs) {
      hermesOptions.timeoutMs = options.timeoutMs;
    }

    if (options.maxContinuations !== undefined) {
      hermesOptions.maxContinuations = options.maxContinuations;
    }

    if (options.signal) {
      hermesOptions.signal = options.signal;
    }

    if (options.onEvent) {
      hermesOptions.onEvent = options.onEvent;
    }

    const result = await askHermes(query, hermesOptions);

    return {
      ok: true,
      tool: 'ask_hermes',
      response: result.text,
      sessionId: result.sessionId,
      continuationCount: result.continuationCount || 0
    };
  }
};

module.exports = hermesTool;
