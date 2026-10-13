'use strict';

const factory = require('./capabilityFactory');
const audit = require('./auditLog');

function list({ enabledOnly = false } = {}) {
  return factory.listProjects()
    .filter(p => p.publishedCapability)
    .map(p => p.publishedCapability)
    .filter(c => !enabledOnly || c.enabled === true);
}
function get(id, { requireEnabled = false } = {}) {
  const capability = list().find(c => c.id === id);
  if (!capability) throw new Error('Registered capability not found.');
  if (requireEnabled && capability.enabled !== true) throw new Error('Capability is registered but disabled.');
  return capability;
}
function register(projectId, config) {
  const project = factory.getProjectById(projectId);
  if (project.publishedCapability) throw new Error('Capability is already registered.');
  const result = factory.publishCapability(projectId, config);
  audit.record('capability.registered_disabled', { projectId, capabilityId: result.publishedCapability.id });
  return result.publishedCapability;
}
module.exports = { list, get, register };
