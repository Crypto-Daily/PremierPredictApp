'use strict';

const fs = require('node:fs');
const path = require('node:path');

const AUDIT_PATH = process.env.SOPHIE_FACTORY_AUDIT ||
  path.join(process.cwd(), 'data', 'capability-factory-audit.jsonl');

function record(event, details = {}) {
  const row = {
    at: new Date().toISOString(),
    event: String(event || 'unknown').slice(0, 100),
    details: JSON.parse(JSON.stringify(details))
  };
  fs.mkdirSync(path.dirname(AUDIT_PATH), { recursive: true, mode: 0o700 });
  fs.appendFileSync(AUDIT_PATH, JSON.stringify(row) + '\n', { mode: 0o600 });
  return row;
}
module.exports = { AUDIT_PATH, record };
