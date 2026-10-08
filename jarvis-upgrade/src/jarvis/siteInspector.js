'use strict';

const { guardedRequest } = require('./netGuard');

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function add(findings, sev, area, msg, fix) {
  findings.push({ sev, area, msg, fix: fix || '' });
}

function analyzeHeaders(headers, { https }) {
  const findings = [];
  const h = name => headers[name.toLowerCase()];

  if (https) {
    if (!h('strict-transport-security')) add(findings, 'medium', 'security', 'No HSTS header.', 'Add Strict-Transport-Security: max-age=31536000; includeSubDomains');
  }
  if (!h('content-security-policy')) add(findings, 'medium', 'security', 'No Content-Security-Policy header.', 'Add a CSP to limit where scripts/styles can load from.');
  if (!h('x-content-type-options')) add(findings, 'low', 'security', 'No X-Content-Type-Options header.', 'Add X-Content-Type-Options: nosniff');
  if (!h('x-frame-options') && !/frame-ancestors/i.test(String(h('content-security-policy') || ''))) {
    add(findings, 'low', 'security', 'Page can be framed by other sites (no X-Frame-Options / frame-ancestors).', 'Add X-Frame-Options: SAMEORIGIN or CSP frame-ancestors.');
  }
  if (!h('referrer-policy')) add(findings, 'low', 'security', 'No Referrer-Policy header.', 'Add Referrer-Policy: strict-origin-when-cross-origin');

  const server = String(h('server') || '');
  if (/\d+\.\d+/.test(server)) add(findings, 'low', 'security', `Server header reveals version: ${server}.`, 'Hide the version (e.g. server_tokens off in nginx).');
  if (h('x-powered-by')) add(findings, 'low', 'security', `X-Powered-By reveals the stack: ${h('x-powered-by')}.`, 'Remove it (app.disable("x-powered-by") in Express).');

  const cookies = [].concat(h('set-cookie') || []);
  for (const cookie of cookies) {
    const name = String(cookie).split('=')[0];
    if (https && !/;\s*secure/i.test(cookie)) add(findings, 'medium', 'cookies', `Cookie "${name}" is missing Secure.`, 'Set the Secure flag.');
    if (!/;\s*httponly/i.test(cookie)) add(findings, 'low', 'cookies', `Cookie "${name}" is missing HttpOnly.`, 'Set HttpOnly unless JS must read it.');
    if (!/;\s*samesite/i.test(cookie)) add(findings, 'low', 'cookies', `Cookie "${name}" has no SameSite.`, 'Set SameSite=Lax or Strict.');
  }

  const type = String(h('content-type') || '');
  if (/text\/html/i.test(type) && !/charset/i.test(type)) add(findings, 'low', 'html', 'Content-Type has no charset.', 'Send text/html; charset=utf-8');
  return findings;
}

function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}

function extractLinks(html, baseUrl) {
  const out = { assets: new Set(), anchors: new Set() };
  const push = (set, value) => {
    if (!value || /^(mailto:|tel:|javascript:|data:|blob:|#)/i.test(value.trim())) return;
    try {
      const url = new URL(value.trim(), baseUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') { url.hash = ''; set.add(url.toString()); }
    } catch { /* ignore malformed */ }
  };
  for (const tag of html.match(/<script\b[^>]*>/gi) || []) push(out.assets, attr(tag, 'src'));
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (/stylesheet|icon|preload|manifest/i.test(attr(tag, 'rel') || '')) push(out.assets, attr(tag, 'href'));
  }
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) push(out.assets, attr(tag, 'src'));
  for (const tag of html.match(/<a\b[^>]*>/gi) || []) push(out.anchors, attr(tag, 'href'));
  return out;
}

function analyzeHtml(html, { finalUrl, https }) {
  const findings = [];
  const facts = {};
  const text = String(html || '');

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  facts.title = title ? title[1].replace(/\s+/g, ' ').trim() : '';
  if (!facts.title) add(findings, 'medium', 'seo', 'Missing <title>.', 'Add a descriptive <title>.');
  else if (facts.title.length > 70) add(findings, 'low', 'seo', `Title is long (${facts.title.length} chars).`, 'Keep titles under about 60 characters.');

  if (!/<meta[^>]+name=["']description["']/i.test(text)) add(findings, 'low', 'seo', 'No meta description.', 'Add <meta name="description" content="...">');
  if (!/<meta[^>]+name=["']viewport["']/i.test(text)) add(findings, 'high', 'mobile', 'No viewport meta tag, so the page will not be mobile friendly.', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">');
  if (!/<html[^>]+\blang=/i.test(text)) add(findings, 'low', 'a11y', '<html> has no lang attribute.', 'Add lang="en" (or your language).');
  if (!/<meta[^>]+charset/i.test(text) && !/charset=/i.test(text.slice(0, 2000))) add(findings, 'low', 'html', 'No charset declared.', 'Add <meta charset="utf-8">');
  if (!/<!doctype html/i.test(text.slice(0, 200))) add(findings, 'low', 'html', 'Missing <!doctype html> (quirks mode risk).', 'Start the document with <!doctype html>.');
  if (/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(text)) add(findings, 'medium', 'seo', 'Page is marked noindex.', 'Remove noindex if the page should appear in search.');
  if (!/<link[^>]+rel=["'][^"']*icon/i.test(text)) add(findings, 'info', 'html', 'No favicon <link> (browsers will request /favicon.ico).', '');

  const h1 = (text.match(/<h1\b/gi) || []).length;
  facts.h1 = h1;
  if (h1 === 0) add(findings, 'low', 'seo', 'No <h1> heading.', 'Add one main <h1>.');
  if (h1 > 1) add(findings, 'low', 'seo', `${h1} <h1> headings (expected 1).`, '');

  const imgs = text.match(/<img\b[^>]*>/gi) || [];
  const noAlt = imgs.filter(tag => attr(tag, 'alt') === null).length;
  facts.images = imgs.length;
  if (noAlt) add(findings, 'medium', 'a11y', `${noAlt} of ${imgs.length} images have no alt attribute.`, 'Add alt text (alt="" for decorative images).');
  const noDims = imgs.filter(tag => !attr(tag, 'width') && !attr(tag, 'height')).length;
  if (imgs.length >= 5 && noDims > imgs.length / 2) add(findings, 'low', 'perf', 'Most images have no width/height (layout shift).', 'Set width and height attributes.');

  if (https) {
    const mixed = (text.match(/\b(?:src|href|action)\s*=\s*["']http:\/\/[^"']+/gi) || []).length;
    if (mixed) add(findings, 'high', 'security', `${mixed} http:// resource/link reference(s) on an https page (mixed content).`, 'Use https:// URLs for all resources.');
  }

  const inlineScripts = (text.match(/<script\b(?![^>]*\bsrc=)[^>]*>/gi) || []).length;
  const externalScripts = (text.match(/<script\b[^>]*\bsrc=/gi) || []).length;
  facts.scripts = { inline: inlineScripts, external: externalScripts };
  if (externalScripts > 15) add(findings, 'low', 'perf', `${externalScripts} external scripts.`, 'Bundle or defer non-critical scripts.');
  const blocking = (text.match(/<script\b(?![^>]*\b(?:defer|async|type=["']module["'])\b)[^>]*\bsrc=[^>]*>/gi) || []).length;
  if (blocking > 3) add(findings, 'low', 'perf', `${blocking} render-blocking scripts in the document.`, 'Add defer/async or move scripts to the end of <body>.');

  const placeholders = /(lorem ipsum|undefined<\/|\[object Object\]|NaN<\/|{{\s*\w+\s*}})/i.exec(text);
  if (placeholders) add(findings, 'medium', 'content', `Possible template/placeholder text on the page ("${placeholders[1].slice(0, 30)}").`, 'Check for unrendered variables or leftover placeholder text.');

  const errorText = /(Traceback \(most recent call last\)|Uncaught \w*Error|Cannot (GET|POST) \/|Internal Server Error|Stack trace:|at\s+\S+\s+\(\S+:\d+:\d+\))/i.exec(text);
  if (errorText) add(findings, 'high', 'errors', `The HTML contains what looks like an error/stack trace ("${errorText[1].slice(0, 40)}").`, 'Fix the server error and disable debug output in production.');

  return { findings, facts, links: extractLinks(text, finalUrl) };
}

async function checkUrls(urls, options, { limit = 25, concurrency = 5 } = {}) {
  const queue = urls.slice(0, limit);
  const results = [];
  let index = 0;

  async function worker() {
    while (index < queue.length) {
      const url = queue[index++];
      try {
        let res = await guardedRequest(url, { ...options, method: 'HEAD', timeoutMs: 6000, readBody: false, maxRedirects: 3 });
        if ([403, 405, 501].includes(res.status)) {
          res = await guardedRequest(url, { ...options, method: 'GET', timeoutMs: 6000, maxBytes: 20000, maxRedirects: 3 });
        }
        results.push({ url, status: res.status, ms: res.timings.totalMs });
      } catch (error) {
        results.push({ url, status: 0, error: error.message.slice(0, 120) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return { results, skipped: Math.max(0, urls.length - queue.length) };
}

function ms(value) { return value == null ? '–' : `${value} ms`; }

async function inspectSite(rawUrl, { allowPrivate = false } = {}) {
  let url = String(rawUrl || '').trim().replace(/[),.;]+$/, '');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const net = { allowPrivate, tolerateBadCert: true };
  const findings = [];
  let main;

  try {
    main = await guardedRequest(url, { ...net, maxBytes: 1500000 });
  } catch (error) {
    const tried = [{ sev: 'critical', area: 'availability', msg: `Could not load ${url}: ${error.message}`, fix: 'Check DNS, the server, the port, and the firewall.' }];
    return { url, ok: false, findings: tried, report: renderReport({ url, findings: tried, facts: {}, main: null, linkResults: null, extra: [] }) };
  }

  const https = /^https:/i.test(main.finalUrl);
  const hops = main.chain.filter(item => item.status);

  if (main.insecureTls) add(findings, 'critical', 'tls', 'The TLS certificate is invalid (expired, self-signed, wrong host or incomplete chain).', 'Renew or reinstall the certificate (e.g. certbot renew).');
  if (!https) add(findings, 'high', 'tls', 'Site is served over plain http.', 'Serve over https and redirect http to https.');
  if (main.tls) {
    if (main.tls.daysLeft < 0) add(findings, 'critical', 'tls', `Certificate expired ${-main.tls.daysLeft} days ago.`, 'Renew it now.');
    else if (main.tls.daysLeft < 14) add(findings, 'high', 'tls', `Certificate expires in ${main.tls.daysLeft} days.`, 'Renew soon (certbot renew).');
    if (main.tls.protocol && /TLSv1(\.0|\.1)?$/.test(main.tls.protocol)) add(findings, 'high', 'tls', `Old TLS version in use (${main.tls.protocol}).`, 'Allow TLS 1.2+ only.');
  }

  if (main.status >= 500) add(findings, 'critical', 'availability', `Server error: HTTP ${main.status}.`, 'Check the application logs (pm2 logs) for the failing request.');
  else if (main.status >= 400) add(findings, 'high', 'availability', `Page returns HTTP ${main.status}.`, 'Check the route/path and server config.');
  if (hops.length > 3) add(findings, 'medium', 'redirects', `${hops.length - 1} redirects before the final page.`, 'Link directly to the final URL.');
  if (/^http:/i.test(url) && https === false) { /* already flagged */ }

  if (main.timings.ttfbMs > 1500) add(findings, 'high', 'perf', `Slow first byte: ${main.timings.ttfbMs} ms.`, 'Check server load, DB queries and caching.');
  else if (main.timings.ttfbMs > 600) add(findings, 'medium', 'perf', `First byte took ${main.timings.ttfbMs} ms.`, 'Consider caching or a faster backend.');
  if (main.timings.totalMs > 3000) add(findings, 'medium', 'perf', `Full document took ${main.timings.totalMs} ms.`, '');

  const encoding = String(main.headers['content-encoding'] || '');
  if (!encoding && main.compressedBytes > 20000) add(findings, 'medium', 'perf', `Response (${Math.round(main.compressedBytes / 1024)} KB) is not compressed.`, 'Enable gzip/brotli.');
  if (!main.headers['cache-control'] && !main.headers.etag && !main.headers['last-modified']) add(findings, 'low', 'perf', 'No caching headers on the document.', 'Add Cache-Control/ETag as appropriate.');
  if (main.bytes > 1000000) add(findings, 'medium', 'perf', `HTML is very large (${Math.round(main.bytes / 1024)} KB).`, 'Split or paginate heavy pages.');
  if (main.truncated) add(findings, 'info', 'scope', 'The page was larger than the 1.5 MB inspection limit and was truncated.', '');

  findings.push(...analyzeHeaders(main.headers, { https }));

  let facts = {};
  let linkResults = null;
  const type = String(main.headers['content-type'] || '');

  if (/html|xml/i.test(type) || /^\s*</.test(main.body.slice(0, 50).toString('utf8'))) {
    const html = main.body.toString('utf8');
    const analysis = analyzeHtml(html, { finalUrl: main.finalUrl, https });
    findings.push(...analysis.findings);
    facts = analysis.facts;

    const targets = [...analysis.links.assets, ...analysis.links.anchors];
    const checked = await checkUrls(targets, net);
    linkResults = checked;
    const broken = checked.results.filter(item => item.status === 0 || item.status >= 400);
    for (const item of broken.slice(0, 12)) {
      add(findings, item.status >= 500 || item.status === 0 ? 'high' : 'medium', 'links',
        `Broken ${analysis.links.assets.has(item.url) ? 'asset' : 'link'}: ${item.url} → ${item.status || item.error}`,
        'Fix the URL or restore the file.');
    }
    if (broken.length > 12) add(findings, 'info', 'links', `…and ${broken.length - 12} more broken URLs.`, '');
    const slow = checked.results.filter(item => item.ms > 2000 && item.status < 400);
    if (slow.length) add(findings, 'low', 'perf', `${slow.length} resource(s) took over 2 s (e.g. ${slow[0].url}).`, '');
  }

  const origin = new URL(main.finalUrl).origin;
  const extra = [];
  for (const path of ['/robots.txt', '/sitemap.xml', '/favicon.ico']) {
    try {
      const res = await guardedRequest(origin + path, { ...net, method: 'GET', timeoutMs: 5000, maxBytes: 4000, maxRedirects: 2 });
      extra.push({ path, status: res.status });
      if (res.status >= 400 && path !== '/favicon.ico') add(findings, 'info', 'seo', `${path} not found (HTTP ${res.status}).`, '');
      if (res.status >= 400 && path === '/favicon.ico' && !/<link[^>]+rel=["'][^"']*icon/i.test(main.body.toString('utf8'))) {
        add(findings, 'low', 'html', 'No favicon (/favicon.ico returns an error).', 'Add a favicon.');
      }
    } catch { extra.push({ path, status: 0 }); }
  }

  findings.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev]);
  const report = renderReport({ url, findings, facts, main, linkResults, extra });
  return { url, ok: true, findings, facts, report };
}

function renderReport({ url, findings, facts, main, linkResults, extra }) {
  const lines = [`## Website inspection: ${url}`];
  if (main) {
    lines.push(
      `Final URL: ${main.finalUrl}`,
      `Status: HTTP ${main.status} · ${Math.round(main.bytes / 1024)} KB · server: ${main.headers.server || 'n/a'}`,
      `Timing: DNS ${ms(main.timings.dnsMs)} · connect ${ms(main.timings.connectMs)}${main.timings.tlsMs ? ` · TLS ${ms(main.timings.tlsMs)}` : ''} · first byte ${ms(main.timings.ttfbMs)} · total ${ms(main.timings.totalMs)}`
    );
    if (main.tls) lines.push(`Certificate: ${main.tls.subject || 'n/a'} (${main.tls.issuer || 'n/a'}), ${main.tls.daysLeft} days left, ${main.tls.protocol || ''}`);
    if (facts.title) lines.push(`Title: ${facts.title}`);
    if (linkResults) lines.push(`Links/assets checked: ${linkResults.results.length}${linkResults.skipped ? ` (+${linkResults.skipped} not checked)` : ''}`);
    if (extra && extra.length) lines.push('Well-known files: ' + extra.map(item => `${item.path} ${item.status || 'err'}`).join(', '));
  }

  const counts = {};
  for (const item of findings) counts[item.sev] = (counts[item.sev] || 0) + 1;
  const summary = Object.keys(SEV_ORDER).filter(sev => counts[sev]).map(sev => `${counts[sev]} ${sev}`).join(', ');
  lines.push('', `### Issues found: ${findings.length}${summary ? ` (${summary})` : ''}`);

  if (!findings.length) lines.push('No problems detected by the static checks.');
  const icon = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵', info: '⚪' };
  for (const item of findings.slice(0, 40)) {
    lines.push(`- ${icon[item.sev]} **${item.sev.toUpperCase()}** [${item.area}] ${item.msg}${item.fix ? ` Fix: ${item.fix}` : ''}`);
  }
  lines.push('', 'Scope: HTTP, TLS, headers, HTML structure and link checks. Runtime JavaScript/console errors need a headless browser (try `run npx playwright --version` to see if one is installed).');
  return lines.join('\n');
}

module.exports = { inspectSite, analyzeHeaders, analyzeHtml, extractLinks, renderReport };
