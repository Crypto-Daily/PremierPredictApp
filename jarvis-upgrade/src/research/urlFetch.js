const { guardedRequest } = require('../jarvis/netGuard');

async function fetchUrl(targetUrl) {
  const response = await guardedRequest(targetUrl, {
    allowPrivate: false,
    maxBytes: 500000,
    timeoutMs: 10000,
    maxRedirects: 3,
    headers: { 'User-Agent': 'Sophie-AI-Research/0.1' }
  });

  return response.body.toString('utf8');
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
