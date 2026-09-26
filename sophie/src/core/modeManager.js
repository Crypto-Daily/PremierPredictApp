'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VALID_MODES = new Set(['GPT', 'JARVIS']);
const DEFAULT_MODE = 'GPT';

class ModeManager {
  constructor(filePath = path.join(process.cwd(), 'data', 'mode.json')) {
    this.file = filePath;
    this.ensureFile();
  }

  ensureFile() {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.file)) this.save(DEFAULT_MODE);
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return VALID_MODES.has(data.mode) ? data.mode : DEFAULT_MODE;
    } catch { return DEFAULT_MODE; }
  }

  save(mode) {
    fs.writeFileSync(this.file, JSON.stringify({ mode, updatedAt: new Date().toISOString() }, null, 2));
  }

  getMode() { return this.load(); }

  setMode(mode) {
    const normalized = String(mode || '').trim().toUpperCase();
    if (!VALID_MODES.has(normalized)) throw new Error('Mode must be GPT or JARVIS.');
    this.save(normalized);
    return normalized;
  }

  isJarvis() { return this.getMode() === 'JARVIS'; }

  describe() {
    const mode = this.getMode();
    return {
      mode,
      name: mode === 'JARVIS' ? 'Jarvis Mode' : 'GPT Mode',
      description: mode === 'JARVIS'
        ? 'Interactive agent mode with authorized perception, device, browser, computer and execution capabilities.'
        : 'Conversational AI mode with reasoning, research and task capabilities.'
    };
  }
}

module.exports = { ModeManager, VALID_MODES };
