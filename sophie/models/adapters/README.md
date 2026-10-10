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


## Hermes integration (MCP)

Sophie exposes its model runtime to Hermes through a local stdio MCP server at `src/models/mcpServer.js`. After deploying the repository to the server, add this entry to `~/.hermes/config.yaml` (merge it with existing settings; do not replace the file):

```yaml
mcp_servers:
  sophie_models:
    command: "node"
    args: ["/home/ubuntu/sophie/src/models/mcpServer.js"]
    env:
      SOPHIE_MODEL_REGISTRY: "/home/ubuntu/sophie/data/model-registry.json"
    timeout: 90
    connect_timeout: 10
```

Restart/reload Hermes after changing its configuration. The server exposes `sophie_list_models`, `sophie_invoke_model`, and `sophie_test_model`. Only enabled models using the supported `openai-compatible` adapter can be invoked. Secrets must remain in the server environment or Hermes configuration environment block, never in the model registry or source control. The default Meta AI bridge requires no API key.

This is a deployment instruction, not a claim that the live Hermes configuration has already been changed. Verify the tools appear in Hermes before relying on this integration.
