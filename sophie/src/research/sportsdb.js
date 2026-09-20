const https = require('https');

const API_KEY = '123';
const BASE = `https://www.thesportsdb.com/api/v1/json/${API_KEY}`;

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
            return reject(new Error(`TheSportsDB HTTP ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error('Invalid JSON from TheSportsDB'));
          }
        });
      }
    ).on('error', reject);
  });
}

// Wikipedia titles for clubs often carry "F.C." / "Football Club" suffixes
// that TheSportsDB's own team names don't use — strip before searching.
function cleanTeamName(name) {
  return name.replace(/\s*(F\.C\.|FC|Football Club)\s*$/i, '').trim();
}

async function searchTeamId(teamName) {
  const cleaned = cleanTeamName(teamName);
  const url = `${BASE}/searchteams.php?t=${encodeURIComponent(cleaned.replace(/\s+/g, '_'))}`;

  const data = await httpGetJson(url);
  const team = data.teams?.[0];

  return team ? { idTeam: team.idTeam, name: team.strTeam } : null;
}

async function getLastEvent(teamId) {
  const url = `${BASE}/eventslast.php?id=${teamId}`;

  const data = await httpGetJson(url);
  const event = data.results?.[0];

  if (!event) return null;

  return {
    homeTeam: event.strHomeTeam,
    awayTeam: event.strAwayTeam,
    homeScore: event.intHomeScore,
    awayScore: event.intAwayScore,
    competition: event.strLeague,
    date: event.dateEvent,
    status: event.strStatus
  };
}

async function getLastMatchForTeamName(teamName) {
  console.log(`[RESEARCH] SportsDB query: team lookup for "${teamName}"`);

  const team = await searchTeamId(teamName);

  if (!team) {
    return null;
  }

  const match = await getLastEvent(team.idTeam);

  if (!match) {
    return null;
  }

  return { team: team.name, ...match };
}

module.exports = {
  getLastMatchForTeamName
};
