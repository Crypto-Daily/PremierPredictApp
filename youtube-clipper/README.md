# Private Video Highlights

A single-user upload page that analyses a video, selects up to 10 spoken-content highlights (each no longer than 90 seconds), compresses them, and sends them to the owner's WhatsApp through the existing Hermes/Baileys bridge.

## Workflow
1. Sign in to the private web page and upload MP4, MOV, M4V, MKV or WebM.
2. Whisper transcribes the video; transcript-scoring heuristics rank non-overlapping 90-second windows.
3. FFmpeg creates compressed 720p-or-smaller MP4 clips.
4. Each clip is sent through the existing Baileys `POST /send-media` bridge.
5. Only after the bridge accepts every clip, the app deletes the original, clips, and job workspace. A small status record remains.
6. If sending fails, source and rendered clips remain on the server and a retry endpoint sends only clips not already accepted.

## Existing server configuration
Keep the existing PM2 process and existing Cloudflare Quick Tunnel arrangement. Configure these values in the environment already used by the `youtube-clipper` PM2 process:

- `APP_PASSWORD` or `APP_PASSWORD_HASH`
- `SECRET_KEY` (stable random secret)
- `COOKIE_SECURE=1`
- `PORT=8765`
- `CLIPPER_DATA=/tmp/youtube-clipper-test/youtube-clipper/data` (or the existing private data directory)
- `WHISPER_MODEL=base`
- `WHATSAPP_BRIDGE_URL=http://127.0.0.1:PORT` (actual Baileys bridge HTTP port)
- `WHATSAPP_CHAT_ID=234XXXXXXXXXX@s.whatsapp.net` (owner's WhatsApp JID)
- `MAX_UPLOAD_BYTES=2147483648` (2 GiB default)

The Baileys bridge must expose `POST /send-media` and accept `{chatId,filePath,mediaType:"video",caption,fileName}`. Its process must be able to read the clip path. The bridge's successful JSON response must contain `{"success":true}`.

## Install / update dependencies
Run inside the clipper virtual environment:
```bash
pip install -r requirements.txt
```
FFmpeg and ffprobe must be installed. Whisper's model is downloaded on first use, so first processing may take longer.

## Important behaviour
- The maximum is 10 clips, not a promise to create 10 if there are fewer useful speech windows.
- Every clip is at most 90 seconds.
- The current highlight ranker uses transcript cues and speech density. It is a lightweight first version, not a human editor or visual scene-understanding model; it can miss silent visual moments.
- Files are removed only after every clip is accepted by Baileys. This confirms acceptance by the bridge, not that the recipient has opened or read each WhatsApp message.
- A partial delivery is tracked. Retry skips clips already accepted, avoiding unnecessary duplicate sends.
- If processing or delivery fails, the original and any generated clips are retained for retry or diagnosis.
- No YouTube URL downloading, browser extension, OAuth, scheduling or publishing workflow is included.
