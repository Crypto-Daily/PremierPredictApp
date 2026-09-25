'use strict';

const {
  getTool,
  listTools
} = require('./index');

/*
 * Tool Router
 *
 * Sophie remains the main assistant.
 * Tools are capabilities Sophie can delegate to.
 *
 * IMPORTANT:
 * - Hermes is never given Sophie's admin passcode.
 * - Hermes does not receive self-upgrade authorization.
 * - Self-upgrade remains handled exclusively by Sophie.
 */

function getAvailableTools() {
  return listTools();
}

function shouldUseHermes(command, intent) {
  const text = String(command || '').toLowerCase();

  /*
   * Explicit Hermes requests always delegate.
   */
  if (
    /\b(use hermes|ask hermes|tell hermes|let hermes|delegate to hermes)\b/i.test(
      text
    )
  ) {
    return true;
  }

  /*
   * Web research / browser tasks.
   */
  if (
    intent === 'WEB_RESEARCH' &&
    /\b(search|research|find|look up|investigate|browse|inspect)\b/i.test(text)
  ) {
    return true;
  }

  /*
   * Browser tasks.
   */
  if (
    /\b(open (the )?browser|browse (the )?web|visit (the )?website|open (the )?website)\b/i.test(
      text
    )
  ) {
    return true;
  }

  /*
   * Terminal / filesystem / environment tasks.
   */
  if (
    /\b(inspect|list|show|check|read|locate)\b.*\b(directory|folder|file|files|folders|contents|filesystem|environment)\b/i.test(text) ||
    /\b(directory|folder|filesystem|file system)\b.*\b(inspect|list|show|check|read)\b/i.test(text) ||
    /\b(run|execute|use)\b.*\b(terminal|command|shell)\b/i.test(text)
  ) {
    return true;
  }

  return false;
}

async function routeTool(command, options = {}) {
  if (!shouldUseHermes(command, options.intent)) {
    return null;
  }

  const tool = getTool('ask_hermes');

  if (!tool) {
    throw new Error('Hermes tool is not registered.');
  }

  console.log('[TOOL] Delegating task to Hermes.');

  const result = await tool.execute(
    {
      query: command
    },
    {
      timeoutMs: options.timeoutMs,
      cwd: options.cwd,
      signal: options.signal,
      onEvent: options.onEvent
    }
  );

  return {
    handled: true,
    tool: 'ask_hermes',
    response: result.response,
    sessionId: result.sessionId || null
  };
}

module.exports = {
  routeTool,
  shouldUseHermes,
  getAvailableTools
};
