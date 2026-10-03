'use strict';

/**
 * NEXUS-OMEGA policy boundary.
 * External content is data, never a higher-priority instruction source.
 */

const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|token|password|passcode)\s*[:=]\s*[^\s]+/ig,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g
];

const UNTRUSTED_SOURCES = new Set(['web','webpage','email','pdf','document','image','api','tool','search']);

function redactSecrets(value) {
  let text = String(value ?? '');
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[REDACTED]');
  return text;
}

function classifyTrust(source) {
  const normalized = String(source || 'model').toLowerCase();
  return UNTRUSTED_SOURCES.has(normalized) ? 'untrusted-data' : 'trusted-instruction';
}

function sanitizeExternalContent(content, source = 'tool') {
  return {
    source,
    trust: classifyTrust(source),
    content: redactSecrets(content),
    instructionLikeTextIsData: true
  };
}

function containsInjection(text) {
  return /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions|ignore\s+all\s+instructions|reveal\s+(?:the|your)\s+(?:system|developer)\s+prompt|bypass\s+(?:security|authentication|access)/i.test(String(text || ''));
}

function capabilityPolicy({ capability, available = true, authorized = true } = {}) {
  if (!available) return { allowed: false, reason: 'Capability is not available in the current environment.' };
  if (!authorized) return { allowed: false, reason: 'Capability is not authorized for this request.' };
  return { allowed: true, capability };
}

module.exports = {
  redactSecrets,
  classifyTrust,
  sanitizeExternalContent,
  containsInjection,
  capabilityPolicy
};
