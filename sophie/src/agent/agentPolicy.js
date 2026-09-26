'use strict';

const ACTION_PATTERNS = [
  /\b(create|make|generate|build|produce|export|convert|save|write)\b.*\b(pdf|docx|word|xlsx|excel|pptx|powerpoint|csv|zip|file|document|spreadsheet|presentation|image|logo|poster)\b/i,
  /\b(save|download|write|create)\b.*\b(workspace|folder|file)\b/i,
  /\b(open|visit|browse|navigate|search|research|investigate)\b/i,
  /\b(run|execute|install|inspect|debug|test|fix|edit|modify)\b.*\b(code|command|terminal|shell|project|server|repository|repo|application|app)\b/i,
  /\b(send|post|upload|download|move|copy|rename|delete)\b/i,
  /\b(turn on|turn off|switch on|switch off|connect|disconnect|control|display|show .* on|put .* on)\b.*\b(tv|phone|computer|screen|device|browser|monitor|speaker|camera)\b/i
];

function hasActionIntent(command) {
  const text = String(command || '').trim();
  return ACTION_PATTERNS.some(pattern => pattern.test(text));
}

function shouldDelegateToHermes({ command, intent, mode = 'GPT' }) {
  const text = String(command || '').trim();

  if (/\b(use hermes|ask hermes|tell hermes|let hermes|delegate to hermes)\b/i.test(text)) return true;
  if (['SELF_UPGRADE', 'SELF_INSPECT', 'MEMORY'].includes(intent)) return false;
  if (intent === 'VISION') return mode === 'JARVIS' && /\b(screen|camera|device|live|environment)\b/i.test(text);
  if (intent === 'DEVICE_CONTROL') return true;
  if (intent === 'CREATION') return true;
  if (intent === 'WEB_RESEARCH') return true;
  if (hasActionIntent(text)) return true;
  if (mode === 'JARVIS') return true;
  return false;
}

module.exports = { hasActionIntent, shouldDelegateToHermes };
