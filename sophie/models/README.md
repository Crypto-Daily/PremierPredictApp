# Sophie model platform

This folder is the home for capability-specific model integrations (image, video, audio, vision, text, and future providers). Do not put API keys, session databases, or generated runtime data in source control.

## Current architecture

1. Sophie owns the UI, access control, local memory, safety boundaries, and protected self-upgrade/inspection workflows.
2. Ordinary requests are routed to the installed Hermes Agent first, in both GPT and Jarvis modes.
3. Hermes receives the enabled model catalog as context and decides which of its configured tools/providers can satisfy the request.
4. The persistent catalog is created at runtime at `data/model-registry.json` (ignored by Git). The authenticated Model Studio UI is available at `/models.html`; its API is `GET/POST /api/models`, `PUT/DELETE /api/models/:id`.
5. Model catalog entries describe availability; they do not magically install SDKs, credentials, or executable adapters. The adapter must exist and be configured before the model can actually run.

## Adding a model

- Open Sophie → **Model Studio**.
- Enter a display name, provider, exact provider model ID, adapter type, optional endpoint, capability tags, and notes.
- For credentials, enter only the environment-variable *name* (for example `FAL_KEY`), never the secret itself.
- Use **Metadata only** until a real adapter is implemented and tested. Do not label a model as executable merely because it is registered.

## Adapter contract

New integrations should live in their own folder under `models/` (or a shared adapter folder) and expose a stable interface that declares:
- provider/model identity and supported capabilities;
- a capability check / availability check;
- an execution method with typed input and output;
- timeout, cancellation, error reporting, and safe credential handling;
- output artifact metadata (MIME type, dimensions, file path or URL as appropriate).

The orchestrator should select an adapter based on the requested capability, the enabled registry entry, provider health, and available credentials. A failed adapter should return a truthful error and must not silently claim success.

## Existing integrations

- `video-generator/`: modular anime/video pipeline with renderer/model adapter seams.
- Hermes CLI: primary agent and execution planner, configured by the Hermes installation.
- Meta AI: existing local WhatsApp bridge, reachable on the server at `http://127.0.0.1:8788/v1` when the service is running.
- Legacy text providers: still present in `src/ai/providerRouter.js`; normal requests now go through Hermes first rather than this router.

## Security / operations

- Registry metadata is stored in the ignored runtime `data/` directory.
- Never put API secrets in model records or commit them to Git.
- The registry API inherits Sophie's API authorization middleware.
- The Hermes-first routing policy intentionally keeps `SELF_UPGRADE`, `SELF_INSPECT`, and `MEMORY` control-plane intents local to Sophie. Self-upgrade remains protected by Upgrade Mode.
