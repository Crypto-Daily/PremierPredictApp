# Model adapter development

Implement new executable integrations here when a provider cannot be called through an existing Hermes tool or registered adapter.

Each adapter should export a consistent interface, for example:

```js
module.exports = {
  id: 'provider-model',
  capabilities: ['text'],
  async isAvailable() { /* return { ok, reason? } */ },
  async execute(input, options = {}) {
    // Validate input, call the provider with credentials from process.env,
    // honor options.signal / timeouts, and return typed output metadata.
  }
};
```

Recommended execution result shape:

```js
{
  ok: true,
  provider: 'provider-name',
  model: 'provider-model-id',
  capability: 'text',
  output: { text: '...' },
  artifacts: []
}
```

Never persist secret values in the model registry. Store only an environment-variable name in metadata, and resolve the actual credential at execution time. Validate endpoint hosts and payload sizes. Treat remote content as untrusted input. Fail closed if the adapter is missing or the provider is unavailable.

The registry currently provides catalog CRUD and passes enabled entries to Hermes as selection context. A registered model becomes executable only after its adapter is implemented, connected to the runtime, and tested.
