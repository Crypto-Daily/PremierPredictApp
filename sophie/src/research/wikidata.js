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
            return reject(new Error(`Wikidata HTTP ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error('Invalid JSON from Wikidata'));
          }
        });
      }
    ).on('error', reject);
  });
}

async function resolveLabel(entityId) {
  const url =
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entityId}&props=labels&languages=en&format=json`;

  const data = await httpGetJson(url);
  return data.entities?.[entityId]?.labels?.en?.value || entityId;
}

// Returns the current head coach/manager for a Wikidata entity (e.g. a football club),
// using property P286. "Current" = a claim with no end-date (P582) qualifier.
async function getCurrentHeadCoach(qid) {
  const url =
    `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P286&format=json`;

  const data = await httpGetJson(url);
  const claims = data.claims?.P286 || [];

  if (claims.length === 0) {
    return null;
  }

  const ongoing = claims.filter(c => !c.qualifiers?.P582);

  let chosen;
  let confident;

  if (ongoing.length >= 1) {
    // If several lack an end date, prefer Wikidata's own "preferred" rank,
    // otherwise take the one with the latest start date.
    chosen =
      ongoing.find(c => c.rank === 'preferred') ||
      ongoing.sort((a, b) => {
        const aStart = a.qualifiers?.P580?.[0]?.datavalue?.value?.time || '';
        const bStart = b.qualifiers?.P580?.[0]?.datavalue?.value?.time || '';
        return bStart.localeCompare(aStart);
      })[0];
    confident = true;
  } else {
    // Every claim has an end date — data may just be stale/unmaintained.
    // Best guess: most recent end date. Flag as low-confidence.
    chosen = claims.sort((a, b) => {
      const aEnd = a.qualifiers?.P582?.[0]?.datavalue?.value?.time || '';
      const bEnd = b.qualifiers?.P582?.[0]?.datavalue?.value?.time || '';
      return bEnd.localeCompare(aEnd);
    })[0];
    confident = false;
  }

  const entityId = chosen.mainsnak?.datavalue?.value?.id;
  if (!entityId) return null;

  const name = await resolveLabel(entityId);
  const since = chosen.qualifiers?.P580?.[0]?.datavalue?.value?.time || null;

  return { name, since, confident };
}

module.exports = {
  getCurrentHeadCoach
};
