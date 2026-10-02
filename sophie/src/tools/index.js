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

registerTool(hermesTool);
registerTool(nexusTool);
registerTool(webSearchTool);
registerTool(artifactTool);
registerTool(memoryTool);
registerTool(multimodalTool);
registerTool(taskTool);
registerTool(workbenchTool);

module.exports = { registerTool, getTool, listTools, describeTool };
