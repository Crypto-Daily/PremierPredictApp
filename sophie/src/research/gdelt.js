const https = require('https');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      {
        headers: {
          'User-Agent': 'Sophie-AI-Research/0.1'
        }
      },
      (res) => {
        let data = '';

        res.on('data', chunk => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(
              new Error(`GDELT HTTP ${res.statusCode}`)
            );
          }

          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(
              new Error('Invalid JSON returned by GDELT')
            );
          }
        });
      }
    ).on('error', reject);
  });
}

async function searchGdelt(query, options = {}) {
  const timespan = options.timespan || '7d';
  const maxrecords = options.maxrecords || 10;

  const params = new URLSearchParams({
    query,
    mode: 'artlist',
    format: 'json',
    timespan,
    maxrecords: String(maxrecords),
    sort: 'datedesc'
  });

  const url =
    `https://api.gdeltproject.org/api/v2/doc/doc?${params}`;

  console.log(`[RESEARCH] GDELT query: ${query}`);

  const data = await fetchJson(url);

  return {
    query,
    articles: Array.isArray(data.articles)
      ? data.articles.map(article => ({
          title: article.title,
          url: article.url,
          domain: article.domain,
          language: article.language,
          seendate: article.seendate
        }))
      : []
  };
}

module.exports = {
  searchGdelt
};
