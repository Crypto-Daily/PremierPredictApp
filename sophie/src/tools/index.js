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
const diagnosticsTool = require('./diagnosticsTool');
const recoveryTool = require('./recoveryTool');
const plannerTool = require('./plannerTool');
const executionTool = require('./executionTool');
const multimodalWorkspaceTool = require('./multimodalWorkspaceTool');
const modelRuntimeTool = require('./modelRuntimeTool');

registerTool(hermesTool);
registerTool(nexusTool);
registerTool(webSearchTool);
registerTool(artifactTool);
registerTool(memoryTool);
registerTool(multimodalTool);
registerTool(taskTool);
registerTool(workbenchTool);
registerTool(workflowTool);
registerTool(diagnosticsTool);
registerTool(recoveryTool);
registerTool(plannerTool);
registerTool(executionTool);
registerTool(multimodalWorkspaceTool);
registerTool(modelRuntimeTool);

module.exports = { registerTool, getTool, listTools, describeTool };
