'use strict';

const dns = require('node:dns');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');

const blocklist = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]
].forEach(([addr, bits]) => blocklist.addSubnet(addr, bits, 'ipv4'));
[
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['2001:db8::', 32], ['64:ff9b::', 96]
].forEach(([addr, bits]) => blocklist.addSubnet(addr, bits, 'ipv6'));

function stripBrackets(host) {
  return String(host || '').replace(/^\[|\]$/g, '');
}

function isPrivateAddress(address) {
  const ip = stripBrackets(address);
  const family = net.isIP(ip);
  if (!family) return false;
  if (family === 4) return blocklist.check(ip, 'ipv4');

  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return blocklist.check(mapped[1], 'ipv4');

  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return blocklist.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, 'ipv4');
  }

  return blocklist.check(ip, 'ipv6');
}

function makeLookup(allowPrivate) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) return callback(error);
      const bad = !allowPrivate && addresses.find(item => isPrivateAddress(item.address));
      if (bad) {
        return callback(new Error(`Blocked: ${hostname} resolves to an internal address (${bad.address}).`));
      }
      if (options && options.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

function assertUrlAllowed(rawUrl, { allowPrivate = false } = {}) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error('Invalid URL.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are supported.');
  }
  const host = stripBrackets(parsed.hostname);
  if (!allowPrivate && (host === 'localhost' || host.endsWith('.localhost') || isPrivateAddress(host))) {
    throw new Error('Blocked: internal/private addresses are not allowed for this request.');
  }
  return parsed;
}

const TLS_RETRY_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'
]);

function requestOnce(rawUrl, options = {}) {
  const {
    method = 'GET', headers = {}, timeoutMs = 10000, maxBytes = 1500000,
    allowPrivate = false, rejectUnauthorized = true, readBody = true
  } = options;

  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = assertUrlAllowed(rawUrl, { allowPrivate }); } catch (error) { return reject(error); }

    const lib = parsed.protocol === 'https:' ? https : http;
    const started = Date.now();
    const timings = {};
    let settled = false;

    const done = (fn, value) => { if (!settled) { settled = true; fn(value); } };

    const req = lib.request(parsed, {
      method,
      headers: { 'User-Agent': 'Sophie-Inspector/1.0', 'Accept': '*/*', ...headers },
      timeout: timeoutMs,
      lookup: makeLookup(allowPrivate),
      rejectUnauthorized
    }, res => {
      timings.ttfbMs = Date.now() - started;
      const chunks = [];
      let size = 0;
      let truncated = false;

      let tls = null;
      if (parsed.protocol === 'https:' && res.socket && typeof res.socket.getPeerCertificate === 'function') {
        const cert = res.socket.getPeerCertificate();
        if (cert && cert.valid_to) {
          tls = {
            protocol: res.socket.getProtocol ? res.socket.getProtocol() : null,
            subject: cert.subject && cert.subject.CN,
            issuer: cert.issuer && (cert.issuer.O || cert.issuer.CN),
            validTo: cert.valid_to,
            daysLeft: Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000),
            authorized: res.socket.authorized === true
          };
        }
      }

      const finish = () => {
        timings.totalMs = Date.now() - started;
        let body = Buffer.concat(chunks);
        const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
        const compressedBytes = body.length;
        try {
          if (encoding === 'gzip') body = zlib.gunzipSync(body, { maxOutputLength: maxBytes * 4 });
          else if (encoding === 'deflate') body = zlib.inflateSync(body, { maxOutputLength: maxBytes * 4 });
          else if (encoding === 'br') body = zlib.brotliDecompressSync(body, { maxOutputLength: maxBytes * 4 });
        } catch { /* truncated or oversized stream: keep raw bytes */ }
        done(resolve, {
          url: rawUrl, status: res.statusCode, headers: res.headers, body, truncated,
          bytes: body.length, compressedBytes, timings, tls
        });
      };

      if (!readBody || method === 'HEAD') { res.resume(); res.on('end', finish); res.on('close', finish); return; }

      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { truncated = true; res.destroy(); return; }
        chunks.push(chunk);
      });
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', error => done(reject, error));
    });

    req.on('socket', socket => {
      socket.once('lookup', () => { timings.dnsMs = Date.now() - started; });
      socket.once('connect', () => { timings.connectMs = Date.now() - started; });
      socket.once('secureConnect', () => { timings.tlsMs = Date.now() - started; });
    });
    req.on('timeout', () => req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)));
    req.on('error', error => done(reject, error));
    req.end();
  });
}

async function guardedRequest(rawUrl, options = {}) {
  const maxRedirects = options.maxRedirects ?? 5;
  const chain = [];
  let current = rawUrl;
  let insecureTls = false;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let response;
    try {
      response = await requestOnce(current, { ...options, rejectUnauthorized: !insecureTls });
    } catch (error) {
      if (!insecureTls && options.tolerateBadCert && TLS_RETRY_CODES.has(error.code)) {
        insecureTls = true;
        chain.push({ url: current, error: `TLS error: ${error.code}` });
        hop--;
        continue;
      }
      error.chain = chain;
      throw error;
    }

    chain.push({ url: current, status: response.status });
    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && location && options.followRedirects !== false) {
      current = new URL(location, current).toString();
      continue;
    }
    return { ...response, finalUrl: current, chain, insecureTls };
  }
  throw Object.assign(new Error(`Too many redirects (more than ${maxRedirects}).`), { chain });
}

module.exports = { isPrivateAddress, assertUrlAllowed, guardedRequest, requestOnce, makeLookup };
