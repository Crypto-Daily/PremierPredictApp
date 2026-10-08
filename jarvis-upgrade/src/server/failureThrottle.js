'use strict';

const crypto = require('node:crypto');

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  const length = Math.max(left.length, right.length, 1);
  const l = Buffer.alloc(length);
  const r = Buffer.alloc(length);
  left.copy(l);
  right.copy(r);
  return crypto.timingSafeEqual(l, r) && left.length === right.length;
}

/*
 * Counts 401 responses per client IP (and globally, in case the IP is shared or spoofed)
 * and answers 429 once the limit is hit. Successful responses reset the client's counter.
 * Only POST requests are counted/blocked.
 */
function createFailureThrottle({ maxFailures = 5, windowMs = 15 * 60 * 1000, globalMaxFailures = 40, now = Date.now } = {}) {
  const perClient = new Map();
  let globalFailures = [];

  const prune = list => list.filter(time => time > now() - windowMs);

  function state(key) {
    const list = prune(perClient.get(key) || []);
    perClient.set(key, list);
    return list;
  }

  function middleware(req, res, next) {
    if (req.method !== 'POST') return next();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const mine = state(key);
    globalFailures = prune(globalFailures);

    if (mine.length >= maxFailures || globalFailures.length >= globalMaxFailures) {
      const oldest = mine.length >= maxFailures ? mine[0] : globalFailures[0];
      const retry = Math.max(1, Math.ceil((oldest + windowMs - now()) / 1000));
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(retry / 60)} minute(s).` });
    }

    res.on('finish', () => {
      if (res.statusCode === 401) {
        mine.push(now());
        perClient.set(key, mine);
        globalFailures.push(now());
      } else if (res.statusCode >= 200 && res.statusCode < 300) {
        perClient.delete(key);
      }
    });
    next();
  }

  middleware.reset = () => { perClient.clear(); globalFailures = []; };
  return middleware;
}

module.exports = { createFailureThrottle, safeEqual };
