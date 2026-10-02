'use strict';

const { redactSecrets, sanitizeExternalContent } = require('./policy');

function buildContext({ memoryFacts = [], conversation = [], research = [], timeContext = null, objective = '' } = {}) {
  const facts = memoryFacts.slice(-50).map(item => redactSecrets(item.fact || item));
  const turns = conversation.slice(-20).map(item => ({
    role: item.role,
    text: redactSecrets(item.text)
  }));

  return {
    objective: redactSecrets(objective),
    memory: facts,
    conversation: turns,
    research: research.map(item => sanitizeExternalContent(item.text || item, item.source || 'tool')),
    time: timeContext,
    contextPolicy: {
      activeContext: true,
      persistentMemoryIsSeparate: true,
      retrievedDataIsEvidence: true,
      modelKnowledgeIsNotCurrentVerification: true
    }
  };
}

function compactContext(context, maxChars = 60000) {
  const copy = JSON.parse(JSON.stringify(context || {}));
  let text = JSON.stringify(copy);
  if (text.length <= maxChars) return copy;

  copy.conversation = (copy.conversation || []).slice(-8);
  copy.research = (copy.research || []).slice(-6);
  copy.memory = (copy.memory || []).slice(-20);
  text = JSON.stringify(copy);

  if (text.length > maxChars) {
    copy.research = (copy.research || []).map(item => ({
      ...item,
      content: String(item.content || '').slice(0, 5000)
    }));
  }

  return copy;
}

module.exports = { buildContext, compactContext };
