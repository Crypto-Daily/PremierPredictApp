# Sophie Animation Studio

A standalone workspace for building a FlipaClip-style, AI-assisted 2D frame-by-frame animation and video-generation studio.

## Isolation rule

All implementation work for this project belongs under `sophie/animation-studio/`. Do not modify Sophie or Hermes core behavior, existing provider implementations, model-factory code, deployment configuration, or production services as part of the standalone build. Integration with Sophie is a later, separately reviewed phase.

## Intended workflow

1. Import a story/scenario PDF and extract text and page imagery.
2. Turn the source into an editable story outline, scenes, shot descriptions, and character/environment references.
3. Generate and manage consistent character and background assets through provider adapters.
4. Create editable keyframes and in-between frames on a frame timeline, with layers and onion-skin previews.
5. Compose scenes, optionally add dialogue/audio, and render MP4/WebM/GIF outputs.
6. Save projects and assets with traceable source references, progress reporting, and recoverable failures.

## Design boundaries

- **Standalone service/UI:** this workspace owns its project data, APIs, job lifecycle, editor, and rendering pipeline.
- **Provider adapters:** AI image, story, motion/interpolation, and optional audio providers are replaceable; provider credentials stay in environment/configuration and must never be committed.
- **Deterministic rendering:** editable frames and scene timing are project data; final video rendering must not depend on an AI provider being available.
- **Reuse without coupling:** existing repository capabilities may be reused only through clear interfaces. Do not duplicate or alter the Sophie/Hermes orchestration engine.
- **Honest capability reporting:** do not label a hosted-model workflow as a newly trained foundation model. Keep the architecture open for a separately trained model if that becomes a defined requirement.

## Workspace map

- `src/` — application modules and service entry points.
- `tests/` — unit, integration, and end-to-end tests.
- `docs/` — architecture decisions, API contracts, data model, setup, and operational notes.
- `package.json` — isolated Node.js workspace scripts.

## Build sequence

1. Complete the repository/infrastructure audit before selecting dependencies or implementing features.
2. Define project/scene/frame/asset schemas and provider contracts.
3. Implement PDF ingestion and story-to-scene planning.
4. Implement asset/reference management and the frame editor/timeline.
5. Implement motion/interpolation and deterministic FFmpeg rendering.
6. Add tests, limits, cancellation/retry behavior, and local setup instructions.
7. Review standalone functionality before planning any optional Sophie integration.

This folder scaffold does not install dependencies, deploy services, change the live Sophie application, or connect the studio to Sophie yet.
