'use strict';

const tools = new Map();

function registerTool(tool) {
  if (!tool || typeof tool.name !== 'string') {
    throw new Error('Invalid tool: name is required.');
  }

  if (typeof tool.execute !== 'function') {
    throw new Error(
      `Invalid tool "${tool.name}": execute() is required.`
    );
  }

  if (tools.has(tool.name)) {
    throw new Error(
      `Tool already registered: ${tool.name}`
    );
  }

  tools.set(tool.name, tool);

  return tool;
}

function getTool(name) {
  return tools.get(name) || null;
}

function listTools() {
  return [...tools.values()].map(tool => ({
    name: tool.name,
    description: tool.description || ''
  }));
}

module.exports = {
  registerTool,
  getTool,
  listTools
};
