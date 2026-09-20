const https = require('https');
const http = require('http');
const { URL } = require('url');

function fetchUrl(targetUrl, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    let parsed;

    try {
      parsed = new URL(targetUrl);
    } catch {
      return reject(new Error('Invalid URL'));
    }

    const lib = parsed.protocol === 'http:' ? http : https;

    const req = lib.get(
      targetUrl,
      { headers: { 'User-Agent': 'Sophie-AI-Research/0.1' }, timeout: 10000 },
      res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          const nextUrl = new URL(res.headers.location, targetUrl).toString();
          res.resume();
          return resolve(fetchUrl(nextUrl, redirectsLeft - 1));
        }

        let data = '';

        res.on('data', chunk => {
          data += chunk;
          if (data.length > 500000) req.destroy();
        });

        res.on('end', () => resolve(data));
      }
    );

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
  });
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchAndSummarizeUrl(targetUrl) {
  console.log(`[URLFETCH] Fetching: ${targetUrl}`);

  try {
    const raw = await fetchUrl(targetUrl);
    const text = stripHtml(raw).slice(0, 4000);

    return { url: targetUrl, found: true, text };
  } catch (error) {
    console.error('[URLFETCH] failed:', error.message);
    return { url: targetUrl, found: false, text: `Could not fetch ${targetUrl}: ${error.message}` };
  }
}

module.exports = {
  fetchAndSummarizeUrl
};
