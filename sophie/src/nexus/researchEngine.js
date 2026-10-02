'use strict';

const { searchWeb } = require('../research/webSearch');
const { sanitizeExternalContent } = require('./policy');

async function research(query, { limit = 6 } = {}) {
  if (!query || !String(query).trim()) throw new Error('Research query is required.');

  const results = await searchWeb(String(query).trim());
  const items = Array.isArray(results) ? results : [];
  return items.slice(0, limit).map((item, index) => {
    const source = item.url || item.link || item.source || 'web';
    const content = item.content || item.snippet || item.description || item.title || '';
    const safe = sanitizeExternalContent(content, source);
    return {
      rank: index + 1,
      title: item.title || '',
      url: item.url || item.link || null,
      content: safe.content,
      trust: safe.trust,
      source
    };
  });
}

module.exports = { research };
