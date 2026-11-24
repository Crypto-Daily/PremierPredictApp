# Private AI Video Clipper

A private, single-user browser app for turning uploaded long-form videos into short highlight clips. It uses Whisper for speech transcription and FFmpeg for rendering. There is no WhatsApp sending workflow.

## Workflow

1. Sign in with the existing app password.
2. Upload MP4, MOV, M4V, MKV or WebM (default maximum 1 GiB).
3. Choose up to 10 highlights.
4. Whisper transcribes speech with word-level timestamps and selects up to 10 non-overlapping highlights, each no longer than 90 seconds.
5. Each selected highlight receives a 0–100 quality score: strong opening (20%), interesting dialogue (20%), gameplay energy (25%), complete context (20%), and good ending (15%). Transcript cues assess dialogue and story structure; sampled FFmpeg scene changes and audio peak level act as lightweight gameplay-energy proxies. This is a heuristic ranking, not a human-level understanding of every visual event.
6. FFmpeg renders 720 × 1280 (9:16) MP4 Reels. The full original gameplay remains visible in the centre and an enlarged, blurred copy fills the background. Whisper word timestamps are burned in as large bold captions, with hook/emotion keywords highlighted.
7. The workspace displays clips in quality-rank order with each category score. Preview clips in the browser and download them individually or all together.
8. When finished, press DONE & DELETE. The app deletes only that job's original video, generated clips and temporary workspace. A small job record remains so the workspace can show that it was deleted.

## Environment

Keep the existing youtube-clipper PM2 environment:
- APP_PASSWORD or APP_PASSWORD_HASH
- SECRET_KEY (stable random secret)
- COOKIE_SECURE=1
- PORT=8765
- CLIPPER_DATA pointing to the existing private data directory
- WHISPER_MODEL=base
- MAX_UPLOAD_BYTES=1073741824 (1 GiB default)

The existing Cloudflare Tunnel startup is retained. No WhatsApp phone number, QR pairing, bridge port or WhatsApp session is required by this version. The old whatsapp-auth data folder is not touched by this application.

## Requirements and install

Python dependencies are listed in requirements.txt. Node/WhatsApp bridge is not started by this version. FFmpeg (built with the `subtitles`/libass filter) and ffprobe must be installed. Whisper downloads its selected model on first use. Caption files are temporary job files and are removed by DONE & DELETE.

## Storage and privacy

- Source video and clips are retained until the user explicitly deletes that job.
- Delete is authenticated, CSRF-protected and scoped to one generated job folder.
- Job records are small JSON files; deleting a job's media does not delete other jobs or app settings.
- Highlight discovery is still speech-led, so silent visual moments may be missed. Gameplay ranking uses sampled scene changes and audio intensity as proxies, not object/scene recognition.
- This is not an unlimited compute service: processing time and practical upload size depend on server CPU, memory and free disk space.
