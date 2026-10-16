# Source workspace

Keep all application code for the standalone animation studio under this directory. Suggested module boundaries, to be finalized after the repository audit:

- `api/` — isolated HTTP API and input validation.
- `projects/` — project, scene, timeline, and asset persistence.
- `ingestion/` — PDF text/page extraction and source-page references.
- `planning/` — story outline, scene, shot, and timing schemas.
- `providers/` — replaceable story, image, motion, and optional audio adapters.
- `animation/` — frame timeline, layers, keyframes, onion skin, interpolation.
- `rendering/` — deterministic composition and FFmpeg export.
- `jobs/` — progress, cancellation, retry, and failure reporting.
- `ui/` — standalone editor interface.

These are planning boundaries, not implemented features. Do not import Sophie/Hermes internals directly without a reviewed interface.
