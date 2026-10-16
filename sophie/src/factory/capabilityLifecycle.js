'use strict';

const factory = require('./capabilityFactory');
const approvals = require('./approvalManager');
const audit = require('./auditLog');

function approve(id, input) {
  const project = approvals.approve(id, input);
  audit.record('blueprint.approved', { projectId: id, revision: project.blueprint.revision });
  return project;
}
function startBuild(id) {
  approvals.requireApproved(id);
  const project = factory.startBuild(id);
  audit.record('build.started', { projectId: id, revision: project.revision });
  return project;
}
function publish(id, input) {
  const project = approvals.requireApproved(id);
  if (project.tests?.passed !== true) throw new Error('Passing recorded tests are required before publication.');
  const result = factory.publishCapability(id, input);
  audit.record('capability.registered_disabled', { projectId: id, capabilityId: result.publishedCapability.id });
  return result;
}
function setEnabled(id, enabled, authorization = {}) {
  const result = factory.setCapabilityEnabled(id, enabled, authorization);
  audit.record(enabled ? 'capability.enabled' : 'capability.disabled', { projectId: id, capabilityId: result.publishedCapability?.id });
  return result;
}
module.exports = { approve, startBuild, publish, setEnabled };
