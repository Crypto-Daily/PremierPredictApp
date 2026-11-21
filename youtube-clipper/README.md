# YouTube clipper

A standalone, single-user web app kept in its own folder. It does not import or connect to Sophie or Hermes.

## What it does

- Accepts a YouTube video URL.
- Downloads the source with yt-dlp.
- Transcribes speech locally with Whisper.
- Ranks transcript sections with simple highlight heuristics (not an LLM).
- Cuts MP4 clips with FFmpeg in 9:16, 16:9, or 1:1.
- Offers downloads in the browser.
- Supports an optional user-supplied Netscape cookies file for videos where YouTube requires the account owner to authenticate.

Only process videos you own or have permission to download and edit. YouTube access restrictions still apply; cookie support does not bypass them.

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

The app binds to 127.0.0.1:8765. Put it behind an HTTPS reverse proxy or a private Cloudflare Tunnel before using it from your phone. Do not expose the Flask development server directly to the internet. For a reverse proxy, preserve HTTPS so the secure session cookie works.

## systemd service

Create `/etc/systemd/system/youtube-clipper.service`:

```ini
[Unit]
Description=Private YouTube clipper
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/youtube-clipper
EnvironmentFile=/etc/youtube-clipper.env
ExecStart=/opt/youtube-clipper/.venv/bin/python /opt/youtube-clipper/app.py
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/lib/youtube-clipper

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now youtube-clipper
sudo systemctl status youtube-clipper
```

## Cookies

Export cookies from your own browser session in Netscape format, then upload the file through the signed-in app. The server stores it under the private data directory with mode 0600. Never commit cookies or send them in chat. Re-export them when they expire.

## Notes and limitations

- The first version selects clips using transcript keyword, punctuation, and sentence-structure heuristics. It is not semantic editorial judgment; inspect the results.
- Whisper model sizes: `tiny`, `base`, `small`, `medium`, `large`. Set `WHISPER_MODEL` before starting. Larger models need more memory and time.
- Jobs are processed in background threads. A process restart stops active jobs; completed files remain in the data directory.
- The source video is removed from temporary work storage after rendering. Generated MP4s and job metadata remain.
- Use HTTPS and a strong password. The app has no public registration or multi-user feature.
