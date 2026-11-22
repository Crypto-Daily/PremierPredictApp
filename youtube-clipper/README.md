# YouTube clipper

A standalone, single-user web app kept in its own folder. It does not import or connect to Sophie or Hermes.

## What it does

- Accepts a video file upload (MP4, MOV, M4V, MKV, or WebM).
- Transcribes speech locally with Whisper.
- Ranks transcript sections with simple highlight heuristics (not an LLM).
- Cuts MP4 clips with FFmpeg in 9:16, 16:9, or 1:1.
- Offers downloads in the browser.

Only process videos you own or have permission to download and edit. 

## Requirements

- Python 3.10+
- FFmpeg installed and available as `ffmpeg`
- Enough disk space for the source video and generated clips
- Whisper model download on first run (CPU is supported but slower)

## Install on Ubuntu

Run from the repository root:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg python3-venv python3-pip
mkdir -p /opt/youtube-clipper
cp -a youtube-clipper/. /opt/youtube-clipper/
cd /opt/youtube-clipper
python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

Create a private environment file:

```bash
sudo install -m 600 /dev/null /etc/youtube-clipper.env
sudo nano /etc/youtube-clipper.env
```

Add a long random password and a persistent secret key (do not commit this file):

```ini
APP_PASSWORD=replace-with-a-long-unique-password
SECRET_KEY=replace-with-a-long-random-secret
COOKIE_SECURE=1
WHISPER_MODEL=base
CLIPPER_DATA=/var/lib/youtube-clipper
```

Create the private data directory and run locally first:

```bash
sudo mkdir -p /var/lib/youtube-clipper
sudo chown -R ubuntu:ubuntu /var/lib/youtube-clipper
chmod 700 /var/lib/youtube-clipper
set -a
. /etc/youtube-clipper.env
set +a
cd /opt/youtube-clipper
. .venv/bin/activate
python app.py
```

The app binds to 127.0.0.1:8765. The deployed PM2 entry starts the Flask app and its supervised Cloudflare Quick Tunnel together. Video files are sent in 8 MiB chunks so large uploads do not need one enormous HTTP request. Keep the dashboard behind HTTPS and use a strong password.

## Notes and limitations

- A cookie export is a sensitive credential. The app does not read cookies directly from your phone; the user chooses and uploads the exported file.
- The first version selects clips using transcript keyword, punctuation, and sentence-structure heuristics. It is not semantic editorial judgment; inspect the results.
- Whisper model sizes: `tiny`, `base`, `small`, `medium`, `large`. Set `WHISPER_MODEL` before starting. Larger models need more memory and time.
- Jobs are processed in background threads. A process restart stops active jobs; completed files remain in the data directory.
- The source video is removed from temporary work storage after rendering. Generated MP4s and job metadata remain.
- Use HTTPS and a strong password. The app has no public registration or multi-user feature.

## Simple upload, clip, download, delete workflow

1. Upload a long video you own or have permission to edit.
2. Wait for Whisper transcription and highlight rendering to finish.
3. Download the generated MP4 clips you want to keep.
4. Press **Done & Delete this job**. The app deletes this job's generated clips, manifest, job record, temporary processing folder, and any remaining incoming upload file. Other jobs and their clips are not touched.

The uploaded source is removed from the temporary processing folder when processing ends. The generated clips remain available until you download them and explicitly delete the job. No Google account, YouTube OAuth, or automatic publishing is required.

The server enforces a maximum upload size using `MAX_UPLOAD_BYTES` (default 4 GiB). If the app is behind a reverse proxy or tunnel with a lower request-body limit, that limit must also be considered for large uploads.
