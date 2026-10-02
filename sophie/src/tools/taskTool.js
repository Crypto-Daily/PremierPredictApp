'use strict';

const { loadTask, listTasks } = require('../nexus/workspaceState');

module.exports = {
  name: 'task_state',
  description: 'Resume and inspect persisted NEXUS tasks.',
  capabilities: ['task_state'],
  risk: 'low',
  async execute({ action = 'list', id, status, limit = 20 } = {}) {
    if (action === 'get') {
      const task = loadTask(id);
      if (!task) return { ok: false, error: 'Task not found.' };
      return { ok: true, task };
    }
    if (action === 'list') return { ok: true, tasks: listTasks({ status, limit }) };
    throw new Error('Unsupported task-state action.');
  }
};
