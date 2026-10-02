'use strict';

function verifyResponse({ text, evidence = [], execution = null, requirements = [] } = {}) {
  const response = String(text || '').trim();
  const checks = {
    nonEmpty: response.length > 0,
    requirementsCovered: requirements.every(r => response.toLowerCase().includes(String(r).toLowerCase())),
    executionHonest: !execution || execution.success !== false,
    evidencePresentWhenRequired: evidence.length === 0 || evidence.some(Boolean),
    noPlaceholderCompletion: !/\b(done|completed|successfully)\b/i.test(response) || Boolean(execution?.success !== false)
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    evidenceCount: evidence.length,
    confidence: Object.values(checks).filter(Boolean).length / Object.keys(checks).length,
    verifiedAt: new Date().toISOString()
  };
}

function labelClaim(type, value) {
  return {
    type,
    value,
    labels: {
      verifiedFact: type === 'verified_fact',
      calculated: type === 'calculated',
      retrieved: type === 'retrieved',
      reasoned: type === 'reasoned',
      assumption: type === 'assumption',
      uncertain: type === 'uncertain'
    }
  };
}

function verifyArtifact(artifact) {
  if (!artifact || typeof artifact.path !== 'string') return { ok: false, reason: 'Artifact metadata is invalid.' };
  return {
    ok: true,
    path: artifact.path,
    size: Number(artifact.size || 0),
    verifiedAt: new Date().toISOString()
  };
}

module.exports = { verifyResponse, labelClaim, verifyArtifact };
