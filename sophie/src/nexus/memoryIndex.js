'use strict';

function tokenize(value) {
  return new Set(String(value || '').toLowerCase().match(/[a-z0-9_]{2,}/g) || []);
}

function score(query, text) {
  const q = tokenize(query);
  const t = tokenize(text);
  if (!q.size || !t.size) return 0;
  let hits = 0;
  for (const term of q) if (t.has(term)) hits++;
  return hits / q.size;
}

function retrieveRelevant(facts = [], messages = [], query = '', limit = 8) {
  const items = [
    ...facts.map((x, i) => ({ type: 'fact', id: i, text: x.fact || '', item: x })),
    ...messages.map((x, i) => ({ type: 'message', id: i, text: x.text || '', item: x }))
  ];
  return items
    .map(item => ({ ...item, relevance: score(query, item.text) }))
    .filter(item => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);
}

module.exports = { retrieveRelevant };
