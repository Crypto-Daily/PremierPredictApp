'use strict';

const HIGH_RISK = new Set(['computer', 'terminal', 'filesystem', 'agent_execution']);

function requiresApproval({ capability, mode = 'GPT', command = '' } = {}) {
  if (!HIGH_RISK.has(capability)) return false;
  if (mode !== 'JARVIS') return true;
  return /\b(delete|remove|send|post|purchase|pay|transfer|install|uninstall|shutdown|format)\b/i.test(String(command));
}

function authorizeAutonomousAction(args = {}) {
  const approvalRequired = requiresApproval(args);
  return {
    allowed: !approvalRequired,
    approvalRequired,
    reason: approvalRequired ? 'High-risk action requires explicit user approval.' : 'Action is within autonomous policy.'
  };
}

module.exports = { requiresApproval, authorizeAutonomousAction };
