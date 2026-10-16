'use strict';

const { request } = require('node:https');
const { request: httpRequest } = require('node:http');

function invokeHttpJson(capability, input, { timeoutMs = 15000 } = {}) {
  if (!capability || capability.enabled !== true) throw new Error('Capability is not enabled.');
  const endpoint = new URL(capability.endpoint);
  if (!['https:', 'http:'].includes(endpoint.protocol)) throw new Error('Unsupported endpoint protocol.');
  if (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) {
    throw new Error('Non-local runtime endpoints must use HTTPS.');
  }
  const send = endpoint.protocol === 'https:' ? request : httpRequest;
  const body = Buffer.from(JSON.stringify(input ?? {}));
  return new Promise((resolve, reject) => {
    const req = send(endpoint, {
      method: 'POST',
      timeout: Math.max(1000, Math.min(Number(timeoutMs) || 15000, 30000)),
      headers: { 'content-type': 'application/json', 'content-length': body.length }
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw = (raw + chunk).slice(0, 1024 * 1024); });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('Capability endpoint returned HTTP ' + res.statusCode + '.'));
        try { resolve(JSON.parse(raw)); } catch { reject(new Error('Capability endpoint returned invalid JSON.')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Capability invocation timed out.')));
    req.on('error', reject);
    req.end(body);
  });
}
module.exports = { invokeHttpJson };
