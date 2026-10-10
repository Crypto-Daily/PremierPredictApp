'use strict';

// Sophie owns the interface, authentication, memory, and protected self-upgrade.
// Hermes is the first agent for all ordinary user requests, including normal chat.
// These local control-plane intents stay in Sophie and never get forwarded.
const LOCAL_ONLY_INTENTS = new Set(['SELF_UPGRADE', 'SELF_INSPECT', 'MEMORY']);

function shouldDelegateToHermes({ command, intent }) {
  const text = String(command || '').trim();
  if (!text) return false;
  if (LOCAL_ONLY_INTENTS.has(intent)) return false;
  // Default route: Hermes receives every other request, regardless of GPT/Jarvis mode.
  return true;
}

module.exports = { shouldDelegateToHermes };
