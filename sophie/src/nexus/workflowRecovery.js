'use strict';
const { loadTask, checkpoint, saveTask } = require('./workspaceState');
function resumeWorkflow(taskId) {
  const task = loadTask(taskId);
  if (!task) throw new Error('Task not found.');
  if (!task.workflow?.stages?.length) throw new Error('Task has no resumable workflow.');
  const current = task.currentStep || task.checkpoint?.workflowStage || task.workflow.stages[0].id;
  const index = task.workflow.stages.findIndex(s => s.id === current);
  const next = task.workflow.stages[Math.min(index + 1, task.workflow.stages.length - 1)];
  return checkpoint({ ...task, status: 'running', currentStep: next?.id || current,
    nextStep: task.workflow.stages[Math.min(index + 2, task.workflow.stages.length - 1)]?.id || null,
    recovery: { resumedAt: new Date().toISOString(), from: current }
  }, 'recovered', { resumedFrom: current });
}
function pauseForApproval(task, reason) {
  return saveTask({ ...task, status: 'awaiting_approval',
    approval: { reason: String(reason || 'Recovery requires human approval.'), at: new Date().toISOString() } });
}
module.exports = { resumeWorkflow, pauseForApproval };
