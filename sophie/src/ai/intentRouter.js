const SELF_INSPECT_PATTERN = /\b(your (source code|architecture|own code)|what files make up|where is your|where'?s your|which file (handles|contains)|show me your (code|architecture|files)|list files in|list the files in|read file|show me the file|show me file|looking for.*(folder|file)|find.*(folder|file)|where is.*located|access (my|the).*folder)\b/i;

const EXPLICIT_SEARCH = /\b(search for|search the web|look up|google that|do some research)\b/i;

const FRESHNESS_WORDS = /\b(latest|today|currently|current|recent(ly)?|this week|this month|breaking news)\b/i;

const VISION_PATTERNS = /\b(analyze this image|look at this|what do you see|what is in this image|what's in this picture)\b/i;

const MEMORY_PATTERN = /\bremember that\b/i;

const CREATION_PATTERN = /^(please\s+|can you\s+|could you\s+)?(create|make|design|build)\b(?!\s+(sure|sense|it|a case|an argument))/i;

const DEVICE_CONTROL_PATTERN = /\b(turn (on|off)|switch (on|off))\s+(the\s+)?\w+/i;\nconst SELF_UPGRADE_PATTERN = /\b(upgrade yourself|modify your own code|change your own code|rewrite your code|improve your architecture|fix your source code|update your own files)\b/i;

function routeIntent(command) {
  const text = command.trim();

  if (SELF_UPGRADE_PATTERN.test(text)) return 'SELF_UPGRADE';\n\n  if (SELF_INSPECT_PATTERN.test(text)) {
    return 'SELF_INSPECT';
  }

  if (EXPLICIT_SEARCH.test(text) || FRESHNESS_WORDS.test(text)) {
    return 'WEB_RESEARCH';
  }

  if (VISION_PATTERNS.test(text)) {
    return 'VISION';
  }

  if (MEMORY_PATTERN.test(text)) {
    return 'MEMORY';
  }

  if (CREATION_PATTERN.test(text)) {
    return 'CREATION';
  }

  if (DEVICE_CONTROL_PATTERN.test(text)) {
    return 'DEVICE_CONTROL';
  }

  return 'CHAT';
}

module.exports = {
  routeIntent
};
