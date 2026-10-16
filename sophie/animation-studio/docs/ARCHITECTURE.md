# Architecture and implementation status

## Implemented
- Standalone Node.js HTTP service and browser-based frame editor.
- Brush/eraser, frame timeline, duplicate/add frames, onion skin, playback, project persistence.
- PDF selectable-text extraction via Poppler and MP4/WebM/GIF export via FFmpeg.
- Deterministic, editable heuristic story-to-scene drafts.
- Local ComfyUI adapter: sends a prompt to a ComfyUI API workflow on the Ubuntu host, polls job history, retrieves a generated PNG, and inserts it into the selected frame. No paid external image provider is required.
- Optional OpenAI-compatible image adapter remains available, but is not required or used by the UI.
- Bounded requests, prompt limits, URL validation, PNG validation and timeouts.

## Local AI requirements and limitations
ComfyUI, a compatible model checkpoint, and an API-format workflow must be installed/configured separately. The repository intentionally does not commit large model weights or silently download them. See `config/comfyui-workflow.example.json`. Copy it to `config/comfyui-workflow.json`, set `ckpt_name` to the checkpoint filename installed in ComfyUI's `models/checkpoints/`, then set `ANIMATION_COMFY_WORKFLOW` to the absolute path and keep `ANIMATION_COMFY_PROMPT_NODE=6`. This sample is a basic text-to-image workflow; it does not guarantee animation consistency or any particular art style.

The installer script can install ComfyUI and Python dependencies, but it does not download model weights. GPU/CUDA compatibility must be checked on the target Ubuntu host. CPU generation can be extremely slow. Do not expose ComfyUI's port publicly; it is configured to bind to loopback.

## Not implemented
- AI understanding of story/PDF; story planning is heuristic.
- Automatic multi-character identity consistency/reference sheets.
- Automated scene/background batch generation.
- Pose-conditioned character animation, motion synthesis, interpolation/optical flow.
- Scanned-PDF OCR, audio, dialogue/lip-sync, layers, keyframe curves.
- Job queue, cancellation, authentication, multi-user isolation and production hardening.
- True motion synthesis: current renderer repeats existing frames to approximate duration.

## Install and test
Requires Node.js 20+, Poppler for PDF text extraction, and FFmpeg for video export.
```bash
cd sophie/animation-studio
npm install
npm run doctor
npm test
npm run check
npm start
```
Open `http://127.0.0.1:8789`. The service binds to loopback by default. Do not expose it publicly without authentication and network controls.

## Local ComfyUI setup
1. Run `bash scripts/setup-local-ai.sh` only after checking the server's available RAM, disk and GPU.
2. Install a compatible model checkpoint into ComfyUI's `models/checkpoints/` directory.
3. Copy `config/comfyui-workflow.example.json` to `config/comfyui-workflow.json` and replace the placeholder checkpoint filename.
4. Export `ANIMATION_LOCAL_IMAGE_URL=http://127.0.0.1:8188`, `ANIMATION_COMFY_WORKFLOW=/absolute/path/to/config/comfyui-workflow.json`, and `ANIMATION_COMFY_PROMPT_NODE=6`.
5. Start ComfyUI with `bash scripts/start-local-ai.sh`, then start Animation Studio in another terminal.

## API
- `GET /api/health`
- `GET /api/local-ai/status`
- `GET /api/projects`
- `POST /api/projects`
- `GET/PUT/DELETE /api/projects/:id`
- `POST /api/images/generate` (local ComfyUI by default; `provider: "external"` opts into external adapter)
- `POST /api/story/plan`
- `POST /api/pdf/extract`
- `POST /api/render`
