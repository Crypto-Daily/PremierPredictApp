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

The app binds to 127.0.0.1:8765. The deployed PM2 entry starts the Flask app and its supervised Cloudflare Quick Tunnel together. Keep the dashboard behind HTTPS and use a strong password.

## Cookies — Android or desktop

Signing in to YouTube in a phone browser does not automatically share that browser session with yt-dlp on the server. You must explicitly export a Netscape-format cookie file and upload it through the signed-in Clipper dashboard.

### Android Firefox

1. Install [Firefox for Android](https://www.mozilla.org/firefox/browsers/mobile/android/).
2. Sign in to YouTube in Firefox.
3. Install Mozilla's [cookies.txt add-on](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/). Review its requested browser permissions before installing; cookie-export extensions need permission to read browser cookies.
4. Open YouTube in the same signed-in Firefox profile and use the add-on to export a Netscape-format `cookies.txt` file.
5. Return to the Clipper dashboard in Firefox, choose the downloaded file in **YouTube login — import from this phone**, and tap **Save cookies privately**.
6. After the server confirms the upload, delete the downloaded cookie file from the phone.

### Desktop

Export your own YouTube cookies from your signed-in browser in Netscape format, then upload the `.txt` file through the dashboard.

The server stores the cookie file under its private data directory with mode 0600 and yt-dlp uses it for both video information and downloads. Cookie files are equivalent to account access: never share them, commit them, or paste their contents into chat. Re-export them when they expire. Uploading replaces the previous cookie file.

## Notes and limitations

- A cookie export is a sensitive credential. The app does not read cookies directly from your phone; the user chooses and uploads the exported file.
- The first version selects clips using transcript keyword, punctuation, and sentence-structure heuristics. It is not semantic editorial judgment; inspect the results.
- Whisper model sizes: `tiny`, `base`, `small`, `medium`, `large`. Set `WHISPER_MODEL` before starting. Larger models need more memory and time.
- Jobs are processed in background threads. A process restart stops active jobs; completed files remain in the data directory.
- The source video is removed from temporary work storage after rendering. Generated MP4s and job metadata remain.
- Use HTTPS and a strong password. The app has no public registration or multi-user feature.

## Desktop browser connector (Edge / Chrome)

The optional companion extension lets you explicitly send the active YouTube video URL to the private Clipper. It does **not** collect browser cookies or automate sign-in. For authenticated yt-dlp downloads, export your own cookies locally in Netscape format and upload them through the private cookie upload control in the Clipper dashboard.

### Install the extension in Microsoft Edge

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the repository folder `youtube-clipper/browser-extension` (the folder containing `manifest.json`).
5. Pin **YouTube Clipper Connector** to the Edge toolbar.

### Pair and send a video

1. Sign in to the Clipper dashboard over HTTPS.
2. Click **Generate one-time pairing code**.
3. Open the extension, enter the Clipper's HTTPS address and the one-time code, then choose **Connect browser**.
4. Open a YouTube video you own or are authorized to process.
5. Click the extension and choose **Send this YouTube video**. The job appears in the existing Clipper queue.

The pairing code expires after 10 minutes and can be used once. Pairing creates a random bearer token; only its SHA-256 hash is stored in the private data directory. The extension reads only the active tab URL after an explicit click; it does not read page contents, inspect cookies, or collect browsing history.

This connector hands off the video URL to the existing yt-dlp pipeline. It does not bypass YouTube restrictions or grant permission to download content.
