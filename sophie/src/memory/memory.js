const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Memory {
  constructor() {
    this.file = path.join(process.cwd(), 'data', 'memory.json');

    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(
        this.file,
        JSON.stringify({ facts: [], threads: {}, activeThreadId: null }, null, 2)
      );
    }

    const memory = this.load();
    let changed = false;

    if (!Array.isArray(memory.facts)) {
      memory.facts = [];
      changed = true;
    }

    if (!memory.threads) {
      memory.threads = {};
      changed = true;
    }

    if (Array.isArray(memory.conversations)) {
      const id = this.generateId();
      memory.threads[id] = {
        id,
        type: 'chat',
        title: 'Chat',
        createdAt: new Date().toISOString(),
        messages: memory.conversations
      };
      memory.activeThreadId = id;
      delete memory.conversations;
      changed = true;
    }

    if (!memory.activeThreadId || !memory.threads[memory.activeThreadId]) {
      if (Object.keys(memory.threads).length === 0) {
        const id = this.generateId();
        memory.threads[id] = {
          id,
          type: 'chat',
          title: 'Chat',
          createdAt: new Date().toISOString(),
          messages: []
        };
        memory.activeThreadId = id;
      } else {
        memory.activeThreadId = Object.keys(memory.threads)[0];
      }
      changed = true;
    }

    if (changed) this.save(memory);
  }

  generateId() {
    return crypto.randomBytes(6).toString('hex');
  }

  load() {
    return JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  save(data) {
    fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
  }

  // =========================
  // LONG-TERM MEMORY (global — shared across all threads)
  // =========================

  rememberFact(fact) {
    const memory = this.load();
    memory.facts.push({ fact, createdAt: new Date().toISOString() });
    this.save(memory);
  }

  getFacts() {
    return this.load().facts;
  }

  // =========================
  // THREADS (Chats and Projects)
  // =========================

  listThreads() {
    const memory = this.load();
    return Object.values(memory.threads).map(t => ({
      id: t.id,
      type: t.type,
      title: t.title,
      createdAt: t.createdAt,
      messageCount: t.messages.length
    }));
  }

  getActiveThreadId() {
    return this.load().activeThreadId;
  }

  getActiveThread() {
    const memory = this.load();
    return memory.threads[memory.activeThreadId];
  }

  findThreadByTitle(query) {
    const memory = this.load();
    const target = query.trim().toLowerCase();

    const threads = Object.values(memory.threads);

    const exact = threads.find(t => t.title.toLowerCase() === target);
    if (exact) return exact;

    const partial = threads.find(
      t => t.title.toLowerCase().includes(target) || target.includes(t.title.toLowerCase())
    );

    return partial || null;
  }

  setActiveThread(id) {
    const memory = this.load();

    if (!memory.threads[id]) {
      throw new Error(`No thread with id ${id}`);
    }

    memory.activeThreadId = id;
    this.save(memory);
  }

  createThread(type, title) {
    const memory = this.load();
    const id = this.generateId();

    memory.threads[id] = {
      id,
      type,
      title,
      createdAt: new Date().toISOString(),
      messages: []
    };

    memory.activeThreadId = id;
    this.save(memory);

    return memory.threads[id];
  }

  renameThread(id, title) {
    const memory = this.load();

    if (!memory.threads[id]) {
      throw new Error(`No thread with id ${id}`);
    }

    memory.threads[id].title = title;
    this.save(memory);

    return memory.threads[id];
  }

  // Deletes a thread. If it was the active one, switches active to
  // whatever thread remains. Refuses to delete your only thread.
  deleteThread(id) {
    const memory = this.load();

    if (!memory.threads[id]) {
      throw new Error(`No thread with id ${id}`);
    }

    const remainingIds = Object.keys(memory.threads).filter(t => t !== id);

    if (remainingIds.length === 0) {
      throw new Error('Cannot delete your only remaining chat or project');
    }

    delete memory.threads[id];

    if (memory.activeThreadId === id) {
      memory.activeThreadId = remainingIds[0];
    }

    this.save(memory);

    return memory.threads[memory.activeThreadId];
  }

  // =========================
  // CONVERSATION MEMORY (always operates on the active thread)
  // =========================

  addMessage(role, text) {
    const memory = this.load();
    const thread = memory.threads[memory.activeThreadId];

    thread.messages.push({ role, text, createdAt: new Date().toISOString() });

    if (thread.messages.length > 100) {
      thread.messages = thread.messages.slice(-100);
    }

    this.save(memory);
  }

  getRecentMessages(limit = 20) {
    const memory = this.load();
    const thread = memory.threads[memory.activeThreadId];
    return thread.messages.slice(-limit);
  }

  clearConversation() {
    const memory = this.load();
    memory.threads[memory.activeThreadId].messages = [];
    this.save(memory);
  }

  getConversationCount() {
    const memory = this.load();
    return memory.threads[memory.activeThreadId].messages.length;
  }
}

module.exports = Memory;
