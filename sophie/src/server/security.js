'use strict';

const crypto = require('node:crypto');

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = Math.max(10, Number(process.env.SOPHIE_RATE_LIMIT || 60));
const MAX_ACTIVE = Math.max(1, Number(process.env.SOPHIE_MAX_CONCURRENT || 4));
const buckets = new Map();

function clientKey(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

function checkRateLimit(req) {
  const key = clientKey(req);
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, active: 0, resetAt: now + WINDOW_MS };
  if (bucket.count >= MAX_REQUESTS) return { allowed: false, status: 429, reason: 'Rate limit exceeded.' };
  if (bucket.active >= MAX_ACTIVE) return { allowed: false, status: 429, reason: 'Too many concurrent Sophie requests.' };
  bucket.count += 1;
  bucket.active += 1;
  buckets.set(key, bucket);
  return { allowed: true, release: () => {
    const current = buckets.get(key);
    if (current) { current.active = Math.max(0, current.active - 1); buckets.set(key, current); }
  }};
}

function expectedToken() {
  return process.env.SOPHIE_API_TOKEN || '';
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authorize(req) {
  const token = expectedToken();
  if (!token) return { allowed: process.env.NODE_ENV !== 'production', reason: 'SOPHIE_API_TOKEN is not configured.' };
  const header = String(req.headers.authorization || '');
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return timingSafeEqualText(supplied, token)
    ? { allowed: true }
    : { allowed: false, reason: 'Authentication required.' };
}

function audit(event, details = {}) {
  const safe = JSON.stringify({ at: new Date().toISOString(), event, ...details });
  console.log('[NEXUS-AUDIT]', safe.slice(0, 4000));
}

module.exports = { checkRateLimit, authorize, audit };
