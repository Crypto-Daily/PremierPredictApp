'use strict';

const { registerTool, getTool, listTools, describeTool } = require('./toolRegistry');
const hermesTool = require('./hermes/hermesTool');
const nexusTool = require('./nexusTool');
const webSearchTool = require('./webSearchTool');
const artifactTool = require('./artifactTool');
const memoryTool = require('./memoryTool');
const multimodalTool = require('./multimodalTool');
const taskTool = require('./taskTool');
const workbenchTool = require('./workbenchTool');
const workflowTool = require('./workflowTool');

registerTool(hermesTool);
registerTool(nexusTool);
registerTool(webSearchTool);
registerTool(artifactTool);
registerTool(memoryTool);
registerTool(multimodalTool);
registerTool(taskTool);
registerTool(workbenchTool);
registerTool(workflowTool);

module.exports = { registerTool, getTool, listTools, describeTool };
