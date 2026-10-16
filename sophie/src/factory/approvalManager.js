'use strict';

const factory = require('./capabilityFactory');

function approve(projectId, { approved, notes = '' } = {}) {
  if (approved !== true) throw new Error('Explicit owner approval is required.');
  return factory.approveBlueprint(projectId, { approved: true, notes });
}
function requireApproved(projectId) {
  const project = factory.getProjectById(projectId);
  if (!project.approval || project.approval.approved !== true || !project.blueprint) {
    throw new Error('The current blueprint has not been explicitly approved.');
  }
  if (project.approval.approvedAt < project.blueprint.createdAt) {
    throw new Error('Approval does not apply to the current blueprint revision.');
  }
  return project;
}
module.exports = { approve, requireApproved };
