'use strict';

const ACTION_PATTERNS = [
  /\b(create|make|generate|build|produce|export|convert|save|write)\b.*\b(pdf|docx|word|xlsx|excel|pptx|powerpoint|csv|zip|file|document|spreadsheet|presentation|image|logo|poster)\b/i,
  /\b(open|visit|browse|search|research|investigate|navigate)\b/i,
  /\b(run|execute|install|inspect|debug|test|fix|edit|modify)\b.*\b(code|command|terminal|shell|project|server|repository|repo|application|app)\b/i,
  /\b(send|post|upload|download|move|copy|rename|delete)\b/i,
  /\b(control|connect|disconnect|turn on|turn off|switch on|switch off)\b/i
];

function hasActionIntent(command) {
  return ACTION_PATTERNS.some(pattern => pattern.test(String(command || '').trim()));
}

function shouldDelegateToHermes({ command, intent, mode = 'GPT' }) {
  const text = String(command || '').trim();
  if (/\b(use hermes|ask hermes|tell hermes|let hermes|delegate to hermes)\b/i.test(text)) return true;
  if (['SELF_UPGRADE', 'SELF_INSPECT', 'MEMORY'].includes(intent)) return false;
  if (intent === 'VISION' && mode === 'JARVIS') return true;
  if (intent === 'DEVICE_CONTROL' || intent === 'CREATION' || intent === 'WEB_RESEARCH') return true;
  if (hasActionIntent(text)) return true;
  return mode === 'JARVIS';
}

module.exports = { hasActionIntent, shouldDelegateToHermes };
