'use strict';
const { askWithFallback } = require('../ai/providerRouter');
const { retry } = require('./recovery');
async function askWithRecovery(userMessage, systemInstruction, options = {}) {
  return retry(() => askWithFallback(userMessage, systemInstruction, options), {
    attempts: Math.min(3, Number(options.attempts || 2)),
    onRetry: options.onRetry
  });
}
module.exports = { askWithRecovery };
