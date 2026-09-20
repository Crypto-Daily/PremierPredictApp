const https = require('https');

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      { headers: { 'User-Agent': 'Sophie-AI-Research/0.1' } },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`Wikipedia HTTP ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error('Invalid JSON from Wikipedia'));
          }
        });
      }
    ).on('error', reject);
  });
}

function extractEntityQuery(query) {
  let q = query.trim();

  q = q.replace(/[?!.]+$/, '');

  q = q.replace(
    /^(who|what|where|when|which|how)\s+(is|are|was|were|did)\s+(the\s+)?(current\s+)?/i,
    ''
  );

  q = q.replace(/\b(current|currently|now|today)\b/gi, '');

  // Strip role/title words (matches "who is the X manager" style)
  q = q.replace(/\b(manager|head coach|coach|ceo|president|captain|owner)\b.*$/i, '');

  // Strip match/score/fixture language (matches "X latest match score" style) —
  // this must run even after the role strip above, since a query can contain
  // neither, either, or both patterns.
  q = q.replace(
    /\b(latest|last|next|recent)?\s*(match|game|score|result|fixture|results)\b.*$/i,
    ''
  );

  q = q.replace(/\bof\b\s*$/i, '');

  q = q.replace(/\s+/g, ' ').trim();

  return q.length > 0 ? q : query.trim();
}

async function findBestTitle(query) {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=1`;

  const data = await httpGetJson(url);
  const hit = data.query?.search?.[0];

  return hit ? hit.title : null;
}

async function searchWikipedia(query) {
  const entityQuery = extractEntityQuery(query);

  console.log(`[RESEARCH] Wikipedia query: "${query}" -> entity: "${entityQuery}"`);

  const directTitle = entityQuery.replace(/\s+/g, '_');
  const directUrl =
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(directTitle)}`;

  let summary = null;

  try {
    summary = await httpGetJson(directUrl);
  } catch (error) {
    summary = null;
  }

  if (!summary || summary.type === 'disambiguation' || !summary.extract) {
    const bestTitle = await findBestTitle(entityQuery);

    if (!bestTitle) {
      return { query, found: false, extract: null, timestamp: null, url: null, wikibaseItem: null };
    }

    const fallbackUrl =
      `https://en.wikipedia.org/api/rest_v1/json/summary/${encodeURIComponent(bestTitle.replace(/\s+/g, '_'))}`;

    summary = await httpGetJson(fallbackUrl);
  }

  return {
    query,
    found: !!summary.extract,
    title: summary.title,
    extract: summary.extract || null,
    timestamp: summary.timestamp || null,
    url: summary.content_urls?.desktop?.page || null,
    wikibaseItem: summary.wikibase_item || null
  };
}

module.exports = {
  searchWikipedia
};
