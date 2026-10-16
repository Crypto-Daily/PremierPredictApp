# Sophie Animation Studio

A standalone workspace for an AI-assisted, FlipaClip-style 2D frame-by-frame animation studio. The first increment is a usable manual drawing/editor service and a foundation for subsequent AI integration; it is not a finished AI animation model.

## Features in this increment
- Browser canvas with brush/eraser, adjustable brush, scenes and scene descriptions.
- Frame timeline, add/duplicate frame, previous-frame onion skin and playback.
- Save/load projects to local JSON files.
- Import selectable-text PDFs using Poppler pdftotext; scanned PDFs require OCR.
- Convert story text into editable heuristic scene drafts.
- Export MP4, WebM and GIF through FFmpeg.
- Node.js built-ins only; no npm runtime dependencies.
- Bounded request bodies, project validation, safe project IDs and tests.

## Install and run
Requirements: Node.js 20+. Optional: Poppler for PDF text extraction and FFmpeg for video export.

```bash
cd sophie/animation-studio
npm install
npm test
npm run check
npm start
```

Open http://127.0.0.1:8789. Projects are saved under data/projects/ (git-ignored). The service binds to loopback by default. Do not expose it publicly without authentication and network controls.

## Current capability boundary
Real AI image generation, character consistency, motion synthesis/interpolation, OCR, audio/lip-sync, layers and advanced timeline editing are not implemented yet. Scene drafting is deterministic heuristic processing, not AI understanding. Video rendering repeats existing drawn frames to approximate scene duration. See docs/ARCHITECTURE.md.

## Isolation
All implementation stays under sophie/animation-studio/. Sophie/Hermes core code, existing providers, production configuration and the live assistant are not changed. Later integration must be a separate reviewed phase.
