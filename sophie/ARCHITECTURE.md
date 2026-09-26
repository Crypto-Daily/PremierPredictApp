# Sophie + Hermes Architecture

## Roles

Sophie is the user-facing personal assistant. She owns identity, personality, conversation, memory, operating mode, permissions, self-upgrade, UI and presentation.

Hermes is Sophie's execution/agent engine. It owns multi-step planning and tool execution across terminal, files, browser, web, vision, image generation, video, skills, MCP, scheduling and other configured integrations.

## Modes

### GPT Mode

Normal conversational Sophie. Simple questions are answered by Sophie's configured model providers. Requests that require real execution are delegated to Hermes.

### Jarvis Mode

Interactive agent mode. Real execution is delegated to Hermes by default. Browser camera/microphone/screen features require explicit browser permission and secure context. Device control requires an actual OS, network, MCP, Home Assistant, desktop or manufacturer interface.

## Request flow

User -> Sophie UI -> CommandProcessor -> Intent Router -> protected Sophie branches or Agent Controller -> Hermes Bridge -> Hermes Agent -> tools/skills/MCP -> result -> Sophie -> user.

Protected Sophie branches:
- SELF_UPGRADE
- SELF_INSPECT
- MEMORY
- other deterministic local operations

Hermes must never receive the Sophie admin passcode.

## Artifacts

Generated files belong in `/workspace` unless a user explicitly requests another safe location. Sophie tracks workspace artifacts and exposes download links through the artifact API.

## Perception

- Camera/photo: browser capture -> Sophie vision.
- Microphone: browser speech recognition currently supplies voice commands.
- Screen: Jarvis Mode browser screen capture -> server capture -> Hermes vision analysis.
- Future continuous video/audio can use Hermes video/voice toolsets and a streaming transport.

## Devices

Sophie does not assume that an HDMI cable or generic device is controllable. Jarvis asks for the physical connection or permission required, then Hermes discovers an actual control interface (browser, desktop automation, Home Assistant, MCP, network API, manufacturer API, etc.) and acts only through an available interface.

## Self-upgrade boundary

Sophie self-upgrade remains protected by Upgrade Mode, backups, validation and checkpointing. Hermes can inspect or assist with project tasks but must not bypass the self-upgrade controller.

## Cancellation

The browser creates a request ID before sending a command. The server tracks the request and exposes status/cancel endpoints. Abort signals propagate to Hermes and terminate the running Hermes process.

## Current execution policy

Artifact creation, web research, browser tasks, device tasks, explicit execution requests and all Jarvis Mode requests are delegated to Hermes. Normal GPT Mode conversation remains on Sophie's configured providers.
