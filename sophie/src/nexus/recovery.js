'use strict';

const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);

function classifyError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const message = String(error?.message || error || '').toLowerCase();
  if (message.includes('permission') || message.includes('authentication') || message.includes('unauthorized') || status === 401 || status === 403) return { kind: 'authorization', recoverable: false, requiresApproval: true };
  if (message.includes('invalid') || message.includes('unsupported') || status === 400 || status === 422) return { kind: 'validation', recoverable: false, requiresApproval: false };
  if (TRANSIENT.has(status) || message.includes('timeout') || message.includes('temporarily') || message.includes('econnreset') || message.includes('network')) return { kind: 'transient', recoverable: true, requiresApproval: false };
  return { kind: 'unknown', recoverable: false, requiresApproval: true };
}
function backoffMs(attempt, base = 500, max = 8000) { return Math.min(max, base * (2 ** Math.max(0, attempt - 1))); }
async function retry(operation, { attempts = 3, classify = classifyError, onRetry } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return { ok: true, value: await operation(attempt), attempts: attempt }; }
    catch (error) {
      lastError = error; const decision = classify(error);
      if (!decision.recoverable || attempt >= attempts) return { ok: false, error, decision, attempts: attempt };
      const delay = backoffMs(attempt); onRetry?.({ attempt, delay, decision });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return { ok: false, error: lastError, decision: classify(lastError), attempts };
}
function canFallback({ failedProvider, candidateProvider, reason } = {}) {
  return Boolean(failedProvider && candidateProvider && failedProvider !== candidateProvider && reason?.recoverable === true);
}
module.exports = { classifyError, backoffMs, retry, canFallback };
