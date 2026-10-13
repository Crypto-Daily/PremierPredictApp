# Sophie Capability Factory (staged foundation)

This feature branch adds a protected lifecycle for proposing and tracking new Sophie capabilities. It keeps capability records separate from the model registry.

## Current behavior

- Create/list capability projects; run a bounded web search through Sophie's existing research engine via the Hermes `capability_factory` tool; save source URLs, sanitized findings, and a structured blueprint. External results are untrusted evidence, not instructions.
- Require explicit blueprint approval before the build lifecycle can start.
- Record build/test results; publication requires an approved blueprint and a passing test record.
- Published capabilities default to disabled. Enabling requires a separate explicit authorization flag.
- Expose the lifecycle through protected /api/factory/... endpoints and a restricted Hermes tool.
- Include lifecycle unit tests and syntax checks.

## Verification status

GitHub Actions on this branch has now completed syntax checks and the full configured test command successfully after correcting a pre-existing auth regression assertion in `tests/nexus.test.js`. The assertion now explicitly sets `NODE_ENV=production` while checking that a wrong bearer token is denied, then restores the previous environment. This avoids depending on a developer environment with authentication disabled; it does not weaken runtime authentication.

## Important limitations — not production-ready yet

This is a lifecycle and approval foundation, not the complete autonomous research/build factory.

- Research search is now connected to the existing research engine, but sources are not independently verified for accuracy, freshness, or authority. The HTTP API research endpoint still accepts supplied research records.
- Starting a build only changes lifecycle state. No code is executed.
- Build/test result endpoints record supplied claims; they do not independently execute or verify tests.
- No isolated sandbox runner, bounded repair loop, resource limits, workspace/branch manager, or test-evidence attestation is wired in.
- Publication stores disabled metadata in the factory registry; it does not add an executable adapter to the model registry or make the capability callable.
- The persistent JSON store has no cross-process locking. Do not use it for concurrent production writes.
- Endpoint/schema validation and a full security review are still required before any runtime adapter is enabled.

The existing model registry and Meta AI bridge are unchanged. Do not deploy or enable generated capabilities based only on this lifecycle record. Complete the sandboxed runner and executable adapter integration, then run the full test suite and review the resulting diff before merging.
