const fs = require('fs');
const path = require('path');

class ModuleManager {
  constructor() {
    this.modulesPath = path.join(process.cwd(), 'src', 'modules');
    this.modules = new Map();
  }

  discover() {
    if (!fs.existsSync(this.modulesPath)) {
      return [];
    }

    const entries = fs.readdirSync(this.modulesPath, {
      withFileTypes: true
    });

    const discovered = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        discovered.push(entry.name);
      }
    }

    return discovered;
  }

  register(name, metadata = {}) {
    this.modules.set(name, {
      name,
      enabled: true,
      ...metadata
    });
  }

  list() {
    return Array.from(this.modules.values());
  }

  has(name) {
    return this.modules.has(name);
  }
}

module.exports = ModuleManager;
