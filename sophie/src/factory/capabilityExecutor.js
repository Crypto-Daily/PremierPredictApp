'use strict';

const registry = require('./capabilityRegistry');
const { invokeHttpJson } = require('./modelAdapter');
const audit = require('./auditLog');

async function execute(id, input, options = {}) {
  const capability = registry.get(id, { requireEnabled: true });
  if (capability.adapter !== 'http-json' && capability.adapter !== 'openai-compatible') {
    throw new Error('This capability adapter is registered but not supported by the current executor.');
  }
  const result = await invokeHttpJson(capability, input, options);
  audit.record('capability.executed', { capabilityId: id, adapter: capability.adapter });
  return result;
}
module.exports = { execute };
