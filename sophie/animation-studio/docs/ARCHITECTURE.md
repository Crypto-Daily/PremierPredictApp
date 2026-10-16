# Architecture and implementation status

## Implemented in this first increment
- Node.js HTTP service using built-in modules; no npm runtime dependencies.
- Browser drawing editor: brush/eraser, scenes, frame timeline, add/duplicate frames, playback, previous-frame onion skin.
- JSON project persistence in ignored data/projects, or ANIMATION_STUDIO_DATA_DIR.
- PDF upload with size limits and selectable-text extraction through Poppler pdftotext. Scanned PDFs are reported clearly and require OCR.
- Deterministic heuristic story-to-scene drafts, all editable; not represented as AI understanding.
- Configurable OpenAI-compatible image-generation API endpoint and server-side provider status, with PNG validation and bounded timeout. A provider key/model and compatible endpoint must be supplied before it can generate images.
- MP4/WebM/GIF rendering through FFmpeg if installed.
- API health, project validation, bounded requests, safe project IDs and static-file path checks.

## Not implemented yet
- Story-planning still uses a local heuristic; no AI story-planning provider is wired into the UI yet.
- Image generation has a backend adapter, but browser controls are still pending and the provider must be configured explicitly.
- Character identity/reference sheets, pose control, asset library and consistency scoring.
- Motion synthesis, optical-flow/interpolation models, video diffusion models or trained weights.
- Layer tracks, audio tracks, keyframe curves, camera controls and non-destructive transformations.
- OCR for scanned PDFs.
- Authentication, multi-user isolation, cloud storage, job queue and deployment hardening.
- True motion interpolation: current rendering repeats drawn frames to approximate scene duration.

## Local setup
Node.js 20+. Optional Poppler pdftotext for text PDFs; optional FFmpeg for exports.
```bash
cd sophie/animation-studio
npm install
npm test
npm run check
npm start
```
Open http://127.0.0.1:8789. Default binds to loopback. Only set ANIMATION_STUDIO_HOST=0.0.0.0 behind suitable authentication and network controls.

## API
- GET /api/health
- GET /api/projects
- POST /api/projects with { "title": "..." }
- GET/PUT/DELETE /api/projects/:id
- POST /api/pdf/extract with { "filename": "...", "data": "data:application/pdf;base64,..." }
- POST /api/story/plan with { "text": "..." }
- POST /api/render with { "project": {...}, "format": "mp4|webm|gif" }
- GET /api/providers

All writes are local files. Do not expose publicly without authentication, rate limiting, and per-user authorization.
