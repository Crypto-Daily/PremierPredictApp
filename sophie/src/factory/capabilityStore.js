'use strict';

// The existing factory module owns durable JSON persistence. This module exposes
// a narrow store interface so callers do not manipulate registry files directly.
const factory = require('./capabilityFactory');
function list(options) { return factory.listProjects(options); }
function get(id) { return factory.getProjectById(id); }
function create(input) { return factory.createProject(input); }
module.exports = { list, get, create };
