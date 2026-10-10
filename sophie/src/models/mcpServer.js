'use strict';

// Minimal stdio MCP server exposing Sophie's registered model runtime to Hermes.
// stdout is reserved for JSON-RPC messages; diagnostics must go to stderr.
const readline = require('node:readline');
const { readRegistry } = require('../server/modelRegistry');
const { invokeModel, testModel } = require('./modelRuntime');

const tools = [
  {
    name: 'sophie_list_models',
    description: 'List enabled registered models and their capabilities. Metadata does not guarantee a model is executable.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'sophie_invoke_model',
    description: 'Invoke a registered OpenAI-compatible model. Use the model ID returned by sophie_list_models. Never claim a call succeeded unless this tool returns a response.',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: { type: 'string', description: 'Registered model ID' },
        prompt: { type: 'string', description: 'User objective to send to that model' },
        system: { type: 'string', description: 'Optional system instruction' },
        timeoutMs: { type: 'number', description: 'Optional timeout, capped by runtime' }
      },
      required: ['modelId', 'prompt'],
      additionalProperties: false
    }
  },
  {
    name: 'sophie_test_model',
    description: 'Test a registered OpenAI-compatible model connection with a fixed verification prompt.',
    inputSchema: {
      type: 'object',
      properties: { modelId: { type: 'string', description: 'Registered model ID' } },
      required: ['modelId'],
      additionalProperties: false
    }
  }
];

function response(id, result, error) {
  const payload = error
    ? { jsonrpc: '2.0', id, error: { code: -32000, message: String(error.message || error).slice(0, 600) } }
    : { jsonrpc: '2.0', id, result };
  process.stdout.write(JSON.stringify(payload) + '\n');
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || !('id' in message)) return;
  try {
    if (message.method === 'initialize') {
      return response(message.id, {
        protocolVersion: message.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'sophie-model-runtime', version: '1.0.0' }
      });
    }
    if (message.method === 'ping') return response(message.id, {});
    if (message.method === 'tools/list') return response(message.id, { tools });
    if (message.method !== 'tools/call') throw new Error('Unsupported MCP method: ' + message.method);
    const name = message.params?.name;
    const args = message.params?.arguments || {};
    let result;
    if (name === 'sophie_list_models') {
      result = { models: readRegistry().models.filter(model => model.enabled).map(({ id, name, provider, model, adapter, capabilities, endpoint }) => ({ id, name, provider, model, adapter, capabilities, endpoint })) };
    } else if (name === 'sophie_invoke_model') {
      result = await invokeModel(args);
    } else if (name === 'sophie_test_model') {
      result = await testModel(args.modelId);
    } else {
      throw new Error('Unknown tool: ' + name);
    }
    return response(message.id, { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false });
  } catch (error) {
    if (message.method === 'tools/call') {
      return response(message.id, { content: [{ type: 'text', text: String(error.message || error).slice(0, 600) }], isError: true });
    }
    return response(message.id, null, error);
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  try {
    const message = JSON.parse(line);
    if (message.method === 'notifications/initialized') return;
    Promise.resolve(handle(message)).catch(error => process.stderr.write('[sophie-model-mcp] ' + error.message + '\n'));
  } catch (error) {
    process.stderr.write('[sophie-model-mcp] Invalid JSON-RPC input: ' + error.message + '\n');
  }
});
