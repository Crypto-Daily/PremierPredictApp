'use strict';

const { selectConsensus } = require('./providerConsensus');

function synthesize({ responses = [], evidence = [], requirements = [] } = {}) {
  const consensus = selectConsensus(responses);
  return {
    text: consensus.text,
    provider: consensus.provider,
    agreement: consensus.agreement,
    sufficientlyAligned: consensus.sufficientlyAligned,
    evidenceCount: evidence.length,
    requirements,
    claimTypes: {
      retrieved: evidence.length > 0,
      reasoned: true,
      uncertain: !consensus.sufficientlyAligned
    }
  };
}

module.exports = { synthesize };
