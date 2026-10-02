'use strict';

function classifyFailure(error, verification) {
  if (error?.code === 'NEXUS_VERIFICATION_FAILED' || verification?.ok === false) return 'verification';
  if (/timeout|timed out/i.test(error?.message || '')) return 'timeout';
  if (/permission|unauthori[sz]ed|forbidden/i.test(error?.message || '')) return 'authorization';
  return 'execution';
}

function recoveryAction(kind) {
  return {
    verification: 'retry_with_stronger_evidence',
    timeout: 'reduce_scope_or_continue',
    authorization: 'request_explicit_approval',
    execution: 'retry_with_reduced_scope'
  }[kind] || 'stop_safely';
}

function recover({ error, verification } = {}) {
  const kind = classifyFailure(error, verification);
  return { kind, action: recoveryAction(kind), safeToRetry: kind !== 'authorization' };
}

module.exports = { classifyFailure, recoveryAction, recover };
