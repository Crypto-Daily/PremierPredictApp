'use strict';

const { invokeModel, testModel } = require('../models/modelRuntime');

module.exports = {
  name: 'invoke_model',
  description: 'Invoke a registered enabled OpenAI-compatible model through Sophie's model runtime.',
  capabilities: ['model_inference', 'text', 'vision'],
  risk: 'medium',
  async execute(input = {}) {
    if (input.action === 'test') return testModel(input.modelId);
    return invokeModel({ modelId: input.modelId, prompt: input.prompt, system: input.system, timeoutMs: input.timeoutMs });
  }
};
