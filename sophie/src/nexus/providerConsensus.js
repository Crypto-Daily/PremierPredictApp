'use strict';

function normalize(text) {
  return String(text || '').trim();
}

function agreementScore(responses = []) {
  if (responses.length < 2) return 1;
  const tokenSets = responses.map(r => new Set(normalize(r.text).toLowerCase().match(/[a-z0-9]{3,}/g) || []));
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < tokenSets.length; i++) {
    for (let j = i + 1; j < tokenSets.length; j++) {
      const a = tokenSets[i], b = tokenSets[j];
      const intersection = [...a].filter(x => b.has(x)).length;
      const union = new Set([...a, ...b]).size;
      total += union ? intersection / union : 0;
      pairs++;
    }
  }
  return pairs ? total / pairs : 0;
}

function selectConsensus(responses = [], { minAgreement = 0.12 } = {}) {
  const usable = responses.filter(r => normalize(r.text));
  if (!usable.length) throw new Error('No provider responses available.');

  const agreement = agreementScore(usable);
  const selected = usable.slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0];

  return {
    provider: selected.provider,
    text: selected.text,
    agreement,
    sufficientlyAligned: agreement >= minAgreement || usable.length === 1,
    candidates: usable.map(r => ({ provider: r.provider, score: r.score || 0 }))
  };
}

module.exports = { agreementScore, selectConsensus };
