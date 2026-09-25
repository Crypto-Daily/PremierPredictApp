'use strict';

const {
  registerTool,
  getTool,
  listTools
} = require('./toolRegistry');

const hermesTool = require('./hermes/hermesTool');

registerTool(hermesTool);

module.exports = {
  registerTool,
  getTool,
  listTools
};
