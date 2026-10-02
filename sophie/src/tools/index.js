'use strict';

const { registerTool, getTool, listTools } = require('./toolRegistry');
const hermesTool = require('./hermes/hermesTool');
const nexusTool = require('./nexusTool');

registerTool(hermesTool);
registerTool(nexusTool);

module.exports = { registerTool, getTool, listTools };
