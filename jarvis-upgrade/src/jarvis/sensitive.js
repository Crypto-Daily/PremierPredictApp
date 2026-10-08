'use strict';

const SENSITIVE_ENV_KEY = /(PASSCODE|PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE|CREDENTIAL|MONGO_URI|DATABASE_URL)/i;

// Commands that would print credentials, no matter who asks. Best effort: the
// goal is to stop accidents and prompt-injected requests, not a determined admin.
const BLOCKED_COMMAND_PATTERNS = [
  [/(^|[\s/"'=])\.env(\.[\w-]+)?($|[\s"';|&])/i, 'an .env file'],
  [/id_(rsa|ed25519|ecdsa|dsa)/i, 'an SSH private key'],
  [/(^|[\s/"'=])\.ssh(\/|$|\s)/i, 'the .ssh folder'],
  [/\.pem\b|\.p12\b|\.pfx\b/i, 'a key/certificate file'],
  [/\.aws\/|\.docker\/config|\.config\/gcloud|\.npmrc|\.netrc|\.git-credentials/i, 'a credentials file'],
  [/\/etc\/(shadow|gshadow|ssh\/)/i, 'a system secret file'],
  [/\/proc\/[^\s]*\/environ/i, 'process environment data'],
  [/(^|[\s;&|])(printenv|env|export\s+-p|declare\s+-x)\s*($|[;&|])/i, 'the environment variables'],
  [/\bpm2\s+(env|show|describe|jlist|prettylist|dump|conf|set)\b/i, 'PM2 process environments'],
  [/\.pm2\/(dump|module_conf|pm2\.conf)/i, 'PM2 saved environments'],
  [/\bdocker\s+(inspect|compose\s+config)\b/i, 'container environments'],
  [/\.bash_history|\.psql_history|\.mysql_history|\.node_repl_history/i, 'shell history'],
  [/\bcredentials\b/i, 'a credentials file']
];

function findBlockedReason(command) {
  const text = String(command || '');
  for (const [pattern, label] of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

const DANGEROUS_PATTERNS = [
  [/\brm\s+(-[a-z]*\s+)*-[a-z]*[rf]/i, 'deletes files recursively/forcefully'],
  [/\b(mkfs|fdisk|parted|wipefs)\b|\bdd\s+if=|>\s*\/dev\/(sd|nvme|xvd)/i, 'can destroy disks'],
  [/\b(shutdown|reboot|poweroff|halt)\b|\binit\s+[06]\b/i, 'powers off/reboots the server'],
  [/:\(\)\s*\{/, 'looks like a fork bomb'],
  [/\b(chmod|chown)\s+-R\b/i, 'changes permissions recursively'],
  [/\b(kill|killall|pkill)\b/i, 'kills processes'],
  [/\bpm2\s+(stop|delete|restart|reload|kill|flush|resurrect|save|startup|unstartup|reset)\b/i, 'changes PM2 processes'],
  [/\bsystemctl\s+(stop|disable|restart|mask|reboot|poweroff|isolate)\b/i, 'changes system services'],
  [/\bgit\s+(reset\s+--hard|clean\b|checkout\s+--|push\b.*(--force|\s-f\b))/i, 'rewrites or discards git work'],
  [/\b(drop\s+(table|database|schema)|truncate\s+table|truncate\s+\w+|delete\s+from\s+\w+\s*(;|$))/i, 'destructive SQL'],
  [/\bsudo\b/i, 'runs with root privileges'],
  [/\bapt(-get)?\s+(remove|purge|autoremove|upgrade|dist-upgrade|full-upgrade)\b/i, 'removes or upgrades system packages'],
  [/\b(curl|wget)\b[^|;]*\|\s*(sudo\s+)?(ba|z)?sh\b/i, 'pipes a download straight into a shell'],
  [/\bcrontab\s+-r\b/i, 'wipes the crontab'],
  [/\b(ufw|iptables|nft)\b/i, 'changes the firewall'],
  [/(^|[^>])>\s*\/etc\//i, 'overwrites a system config file'],
  [/\b(userdel|usermod|passwd|visudo|adduser|useradd)\b/i, 'changes user accounts']
];

function classifyRisk(command) {
  const text = String(command || '');
  const reasons = DANGEROUS_PATTERNS.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  return { dangerous: reasons.length > 0, reasons };
}

const TOKEN_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bgsk_[A-Za-z0-9]{20,}\b/g,
  /\bnvapi-[A-Za-z0-9_-]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g
];

function redactSecrets(input) {
  let text = String(input ?? '');

  for (const [key, value] of Object.entries(process.env)) {
    if (SENSITIVE_ENV_KEY.test(key) && value && value.length >= 8) {
      text = text.split(value).join('[REDACTED]');
    }
  }

  text = text.replace(
    /((?:api[_-]?key|secret|token|passcode|password|passwd|private[_-]?key|authorization)["']?\s*[:=]\s*["']?)([^\s"',;]{6,})/gi,
    '$1[REDACTED]'
  );

  for (const pattern of TOKEN_PATTERNS) text = text.replace(pattern, '[REDACTED]');
  return text;
}

function cleanEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (SENSITIVE_ENV_KEY.test(key)) continue;
    if (key === 'PORT' || key.startsWith('pm_') || key.startsWith('PM2_') && key !== 'PM2_HOME') continue;
    env[key] = value;
  }
  const home = process.env.HOME || require('node:os').homedir();
  const extraPaths = [`${home}/.local/bin`, `${home}/.npm-global/bin`, '/usr/local/bin', '/usr/local/sbin', '/usr/sbin', '/sbin'];
  env.PATH = [...extraPaths, env.PATH || '/usr/bin:/bin'].join(':');
  env.HOME = home;
  env.TERM = 'dumb';
  env.CI = '1';
  return { ...env, ...extra };
}

function truncateOutput(text, max = 7000) {
  const value = String(text || '');
  if (value.length <= max) return value;
  const head = Math.floor(max * 0.55);
  const tail = max - head;
  return `${value.slice(0, head)}\n…[${value.length - max} characters omitted]…\n${value.slice(-tail)}`;
}

module.exports = { findBlockedReason, classifyRisk, redactSecrets, cleanEnv, truncateOutput, SENSITIVE_ENV_KEY };
