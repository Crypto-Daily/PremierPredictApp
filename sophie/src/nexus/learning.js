'use strict';

function summarizeRun({ task, result } = {}) {
  return {
    taskId: task?.id || null,
    objective: task?.objective || '',
    intent: task?.intent || 'CHAT',
    status: result?.ok ? 'success' : 'failed',
    iterations: result?.iterations || 0,
    verification: result?.state?.verification || null,
    learnedAt: new Date().toISOString()
  };
}

function deriveLessons(history = []) {
  return history
    .filter(item => item.phase === 'VERIFY' && item.verification && !item.verification.ok)
    .map(item => ({
      type: 'verification_failure',
      iteration: item.iteration,
      checks: item.verification.checks || item.verification
    }));
}

module.exports = { summarizeRun, deriveLessons };
