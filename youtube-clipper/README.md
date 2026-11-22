# Private Video Highlights

Single-user video upload app. It finds up to 10 spoken-content highlights (maximum 90 seconds each), compresses them, and sends them to a dedicated WhatsApp account linked by QR code.

## WhatsApp session
- The app starts its own Baileys process as a child of the existing Python app. It is **not** a second PM2 process.
- The session is stored in `CLIPPER_DATA/whatsapp-auth`, separate from Sophie's credentials.
- Open the Clipper page and scan the QR code using WhatsApp → Linked devices → Link a device.
- Set `WHATSAPP_PHONE_NUMBER` to the destination number in international format without plus signs or spaces, e.g. `2348012345678`. The app converts it to a WhatsApp JID.
- Keep the session folder private and backed up securely. Do not share its contents or QR code.

## Environment
Configure these in the existing `youtube-clipper` PM2 process:
- `APP_PASSWORD` or `APP_PASSWORD_HASH`
- `SECRET_KEY` (stable random secret)
- `COOKIE_SECURE=1`
- `PORT=8765`
- `CLIPPER_DATA=/tmp/youtube-clipper-test/youtube-clipper/data` (use the existing private data directory)
- `WHISPER_MODEL=base`
- `WHATSAPP_PHONE_NUMBER=234XXXXXXXXXX` (destination account; digits only)
- Optional `WHATSAPP_AUTH_DIR` (defaults to `CLIPPER_DATA/whatsapp-auth`)
- Optional `WHATSAPP_BRIDGE_URL` (defaults to internal `http://127.0.0.1:8766`)
- `MAX_UPLOAD_BYTES=1073741824` (1 GiB default recommended for the available disk space)

## Install
Inside the existing app directory:
```bash
npm install --omit=dev
.venv/bin/pip install -r requirements.txt
```
Node.js, FFmpeg and ffprobe must be installed. Whisper's model downloads on first use.

## Workflow and storage
1. Sign in and upload MP4, MOV, M4V, MKV or WebM.
2. Whisper transcribes speech; a lightweight transcript scorer ranks non-overlapping windows.
3. FFmpeg renders compressed MP4 clips at up to 720p.
4. Baileys sends each clip to the configured WhatsApp number.
5. Only after Baileys accepts every clip, the app deletes the original and generated clips.
6. If delivery fails, files remain for retry; accepted clips are not sent again.

The transcript scorer is not visual scene understanding and can miss silent visual highlights. A successful send response means Baileys accepted the message for sending, not that it was read. A full QR code is displayed only to an authenticated Clipper user.
