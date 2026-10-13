# Sophie Capability Factory

This feature implements the approved capability lifecycle for Sophie and Hermes: create a project, collect research, draft and revise a blueprint, require explicit approval, verify submitted source files in an isolated sandbox, register passing capabilities disabled by default, and expose registered capability discovery and invocation.

## Workflow

1. Create a project with a name, goal, requirements, and constraints.
2. Research the project and save sources/findings.
3. Save and revise a structured blueprint. A blueprint revision clears prior approval and prior build/test/publication evidence.
4. Approve the current blueprint through the authenticated API.
5. Submit source files to the sandbox verification endpoint or Hermes `build_and_verify` tool. The source-file generation itself must be supplied by Hermes/the caller; this pipeline does not claim to autonomously write arbitrary source code.
6. Verification runs syntax checks and the submitted package test script in a Docker container with network disabled, read-only container root, dropped Linux capabilities, no-new-privileges, CPU/memory/PID limits, and a timeout.
7. Only a successful verified result may be published to the capability registry. Publication is disabled by default; enabling requires a separate explicit authorization.
8. Sophie can discover registered capabilities. The HTTP JSON adapter invokes only enabled capabilities and limits remote endpoints to HTTPS (plain HTTP is allowed only on loopback).

## API

- `GET/POST /api/factory/projects`
- `GET /api/factory/projects/:id`
- `POST /api/factory/projects/:id/research`
- `POST /api/factory/projects/:id/blueprint`
- `POST /api/factory/projects/:id/approve`
- `POST /api/factory/projects/:id/build/start`
- `POST /api/factory/projects/:id/build/verify`
- `POST /api/factory/projects/:id/build/result`
- `POST /api/factory/projects/:id/tests/result`
- `POST /api/factory/projects/:id/publish`
- `POST /api/factory/projects/:id/enable`
- `POST /api/factory/projects/:id/disable`
- `GET /api/factory/capabilities`
- `POST /api/factory/capabilities/:id/execute`

All these routes are behind the server's existing API authorization middleware.

## Important boundaries

- This is a capability factory, not a system that trains a new foundation model. Model endpoints can be registered as capabilities; training/fine-tuning needs separate infrastructure.
- The factory tool can create/research/blueprint projects and submit caller-provided files for sandbox verification. It cannot approve a blueprint or enable a capability.
- The source files tested are those supplied in the verification request. Passing tests do not prove a third party's claims or model quality.
- The Docker sandbox image must already exist locally; it is not pulled automatically.
- Runtime capability execution currently supports the `http-json` adapter and an `openai-compatible` label through the same JSON HTTP invocation interface. Other registered adapter labels are not executed by the current executor.
- The JSON registry is suitable for the current single-process lifecycle foundation but does not implement cross-process locking.
- This branch does not deploy, restart, or merge into production. Run checks and inspect the diff before activation.
