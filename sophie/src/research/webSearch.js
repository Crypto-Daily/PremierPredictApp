const { searchGdelt } = require('./gdelt');
const { searchWikipedia } = require('./wikipedia');
const { getCurrentHeadCoach } = require('./wikidata');
const { getLastMatchForTeamName } = require('./sportsdb');

const COACH_PATTERN = /\b(manager|head coach|coach)\b/i;
const MATCH_PATTERN = /\b(score|match|result|fixture|played|game)\b/i;

async function performWebResearch(query) {
  const sections = [];
  const groundTruthTerms = [];
  let anyFound = false;

  let wiki = null;

  try {
    wiki = await searchWikipedia(query);

    if (wiki.found) {
      anyFound = true;
      sections.push(
        `Wikipedia (${wiki.title}, last edited ${wiki.timestamp}):\n${wiki.extract}`
      );
    }
  } catch (error) {
    console.error('[RESEARCH] Wikipedia failed:', error.message);
  }

  if (wiki?.wikibaseItem && COACH_PATTERN.test(query)) {
    try {
      const coach = await getCurrentHeadCoach(wiki.wikibaseItem);

      if (coach) {
        anyFound = true;
        groundTruthTerms.push(coach.name);
        sections.push(
          `Wikidata structured fact — current head coach/manager of ${wiki.title}: ${coach.name}` +
          (coach.since ? ` (since ${coach.since})` : '') +
          (coach.confident ? '' : ' [low confidence — no ongoing record found, this is the most recent past holder]')
        );
      }
    } catch (error) {
      console.error('[RESEARCH] Wikidata failed:', error.message);
    }
  }

  if (wiki?.title && MATCH_PATTERN.test(query)) {
    try {
      const match = await getLastMatchForTeamName(wiki.title);

      if (match) {
        anyFound = true;
        groundTruthTerms.push(`${match.homeScore}-${match.awayScore}`);
        sections.push(
          `TheSportsDB structured fact — last match for ${match.team}: ` +
          `${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam} ` +
          `(${match.competition}, ${match.date}, status: ${match.status})`
        );
      }
    } catch (error) {
      console.error('[RESEARCH] SportsDB failed:', error.message);
    }
  }

  try {
    const news = await searchGdelt(query, { timespan: '7d', maxrecords: 8 });

    if (news.articles && news.articles.length > 0) {
      anyFound = true;
      const lines = news.articles.map(
        a => `- "${a.title}" (${a.domain}, ${a.seendate})`
      );
      sections.push(`Recent news headlines (last 7 days):\n${lines.join('\n')}`);
    }
  } catch (error) {
    console.error('[RESEARCH] GDELT failed:', error.message);
  }

  if (!anyFound) {
    return {
      query,
      found: false,
      text: `No web research results found for "${query}". Do not present cached/trained knowledge as current fact — say the information could not be verified.`,
      groundTruthTerms: []
    };
  }

  return {
    query,
    found: true,
    text: sections.join('\n\n'),
    groundTruthTerms
  };
}

module.exports = {
  performWebResearch
};
