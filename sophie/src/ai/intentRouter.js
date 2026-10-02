'use strict';

const PATTERNS = {
  SELF_UPGRADE: /\b(upgrade yourself|modify your own code|change your own code|rewrite your code|improve your architecture|fix your source code|update your own files)\b/i,
  SELF_INSPECT: /\b(your source code|your architecture|what files make up|where is your|which file (handles|contains)|show me your (code|architecture|files)|list files in|read file|show me the file|find.*(folder|file))\b/i,
  WEB_RESEARCH: /\b(search for|search the web|look up|google that|research|investigate|latest|today|currently|current|recent|this week|this month|breaking news)\b/i,
  VISION: /\b(analyze this image|look at this|what do you see|what is in this image|what's in this picture|inspect this screenshot)\b/i,
  MEMORY: /\b(remember that|remember this|forget that)\b/i,
  CREATION: /^\s*(please\s+|can you\s+|could you\s+)?(create|make|design|build|generate)\b/i,
  DEVICE_CONTROL: /\b(turn (on|off)|switch (on|off)|control|connect|disconnect)\b.*\b(tv|phone|computer|screen|device|browser|monitor|speaker|camera)\b/i
};

function routeIntent(command) {
  const text = String(command || '').trim();
  for (const [intent, pattern] of Object.entries(PATTERNS)) {
    if (pattern.test(text)) return intent;
  }
  return 'CHAT';
}

function classifyComplexity(command) {
  const text = String(command || '');
  const score =
    (text.length > 250 ? 1 : 0) +
    ((text.match(/\b(and|then|after|before|also|finally)\b/gi) || []).length >= 2 ? 1 : 0) +
    ((text.match(/\b(create|execute|research|inspect|debug|test|build|edit)\b/gi) || []).length >= 2 ? 1 : 0);

  return score >= 2 ? 'complex' : score === 1 ? 'moderate' : 'simple';
}

module.exports = { routeIntent, classifyComplexity };
