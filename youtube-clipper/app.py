from __future__ import annotations

import json
import logging
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import whisper
import yt_dlp
from flask import Flask, abort, jsonify, redirect, render_template, request, send_from_directory, session, url_for
from werkzeug.security import check_password_hash
from youtube_publisher import make_flow, save_credentials, upload_scheduled_video

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("youtube_clipper")

BASE = Path(__file__).resolve().parent
DATA = Path(os.environ.get("CLIPPER_DATA", BASE / "data")).resolve()
JOBS = DATA / "jobs"
OUTPUTS = DATA / "clips"
UPLOADS = DATA / "private"
INCOMING = DATA / "incoming"
for folder in (JOBS, OUTPUTS, UPLOADS, INCOMING):
    folder.mkdir(parents=True, exist_ok=True)
    try:
        folder.chmod(0o700)
    except OSError:
        pass

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                  SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "1") == "1",
                  MAX_CONTENT_LENGTH=int(os.environ.get("MAX_UPLOAD_BYTES", str(4 * 1024 * 1024 * 1024))))
PASSWORD_HASH = os.environ.get("APP_PASSWORD_HASH", "")
PASSWORD = os.environ.get("APP_PASSWORD", "")
COOKIE_FILE = UPLOADS / "youtube-cookies.txt"
MAX_VIDEO_SECONDS = int(os.environ.get("MAX_VIDEO_SECONDS", "10800"))
jobs_lock = threading.Lock()
jobs: dict[str, dict] = {}
whisper_model = None
whisper_lock = threading.Lock()


def logged_in():
    return session.get("authenticated") is True


def require_login():
    if not logged_in():
        abort(401)


def valid_youtube_url(value: str) -> bool:
    try:
        parsed = urlparse(value.strip())
        host = (parsed.hostname or "").lower()
        return parsed.scheme == "https" and (host == "youtu.be" or host == "youtube.com" or host.endswith(".youtube.com"))
    except Exception:
        return False


def update_job(job_id: str, **changes):
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(changes)
            (JOBS / f"{job_id}.json").write_text(json.dumps(jobs[job_id], indent=2))


def run_command(args: list[str]):
    subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def yt_dlp_runtime_options():
    """Use Node for YouTube JS challenges and fetch yt-dlp's EJS solver when needed."""
    node_path = os.environ.get("YT_DLP_NODE_PATH") or shutil.which("node") or "/home/ubuntu/.local/bin/node"
    if not Path(node_path).is_file():
        raise RuntimeError(f"yt-dlp JavaScript runtime was not found: {node_path}")
    return {
        "js_runtimes": {"node": {"path": node_path}},
        "remote_components": ["ejs:github"],
    }


def extract_youtube_info(video_url: str):
    """Extract YouTube metadata using mweb, uploaded cookies, BgUtils PO tokens and Node."""
    extractor_args = {"youtube": {"player_client": ["mweb"]}}
    info_opts = {
        "quiet": True,
        "no_warnings": False,
        "noplaylist": True,
        "socket_timeout": 30,
        "extractor_args": extractor_args,
        **yt_dlp_runtime_options(),
    }
    if COOKIE_FILE.exists():
        info_opts["cookiefile"] = str(COOKIE_FILE)
    try:
        with yt_dlp.YoutubeDL(info_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)
        if info and (info.get("formats") or info.get("url")):
            logger.info("YouTube metadata extracted using mweb, Node JS runtime and BgUtils PO tokens")
            return info, extractor_args
        raise RuntimeError("mweb returned no downloadable formats")
    except Exception as exc:
        logger.exception("YouTube mweb extraction failed")
        raise RuntimeError(
            "YouTube extraction failed with mweb + Node JS challenge solving + BgUtils PO tokens: "
            + str(exc)[:500]
        ) from exc


def load_model():
    global whisper_model
    with whisper_lock:
        if whisper_model is None:
            model_name = os.environ.get("WHISPER_MODEL", "base")
            whisper_model = whisper.load_model(model_name)
        return whisper_model


def score_text(text: str) -> float:
    words = re.findall(r"[a-zA-Z']+", text.lower())
    if not words:
        return 0.0
    signals = {
        "surprise": ["wow", "unbelievable", "suddenly", "never", "shocking", "incredible"],
        "emotion": ["love", "fear", "angry", "cry", "laugh", "amazing", "terrible"],
        "emphasis": ["important", "secret", "truth", "mistake", "remember", "best", "worst"],
        "story": ["because", "then", "but", "until", "finally", "imagine", "realize"],
    }
    hits = sum(1 for word in words if any(word in group for group in signals.values()))
    punctuation = text.count("!") + text.count("?")
    length_bonus = min(len(words) / 35.0, 1.0)
    return hits * 1.4 + punctuation * 0.7 + length_bonus


def choose_highlights(segments, video_duration: float, count: int, clip_seconds: int):
    candidates = []
    for seg in segments:
        start = max(0.0, float(seg["start"]) - 5.0)
        end = min(video_duration, start + clip_seconds)
        if end - start < min(15, clip_seconds):
            continue
        score = score_text(seg.get("text", ""))
        candidates.append({"start": start, "end": end, "score": score, "text": seg.get("text", "").strip()})
    candidates.sort(key=lambda x: x["score"], reverse=True)
    chosen = []
    for item in candidates:
        if all(item["end"] <= old["start"] or item["start"] >= old["end"] for old in chosen):
            chosen.append(item)
        if len(chosen) >= count:
            break
    if not chosen and video_duration > 0:
        for i in range(min(count, max(1, int(video_duration // clip_seconds)))):
            start = min(i * clip_seconds, max(0, video_duration - clip_seconds))
            chosen.append({"start": start, "end": min(video_duration, start + clip_seconds), "score": 0, "text": ""})
    return sorted(chosen, key=lambda x: x["start"])


def process_video(job_id: str, video_url: str, count: int, clip_seconds: int, aspect: str, source_path: Path | None = None):
    work = JOBS / job_id
    work.mkdir(parents=True, exist_ok=True)
    try:
        selected_extractor_args = None
        if source_path is not None:
            update_job(job_id, status="validating", progress=5, message="Checking your uploaded video…")
            if not source_path.is_file():
                raise FileNotFoundError("The uploaded source video is no longer available.")
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(source_path)],
                check=True, capture_output=True, text=True, timeout=60,
            )
            duration = float(probe.stdout.strip())
            info = {"title": source_path.stem, "duration": duration}
            video = work / ("source" + source_path.suffix.lower())
            shutil.move(str(source_path), str(video))
        else:
            update_job(job_id, status="downloading", progress=5, message="Getting video information…")
            info, selected_extractor_args = extract_youtube_info(video_url)
            duration = float(info.get("duration") or 0)
            source = work / "source.%(ext)s"
            opts = {
                "format": "bestvideo*+bestaudio/best",
                "outtmpl": str(source),
                "merge_output_format": "mp4",
                "quiet": True,
                "no_warnings": False,
                "noplaylist": True,
                **yt_dlp_runtime_options(),
            }
            if COOKIE_FILE.exists():
                opts["cookiefile"] = str(COOKIE_FILE)
            if selected_extractor_args:
                opts["extractor_args"] = selected_extractor_args
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([video_url])
            videos = [p for p in work.iterdir() if p.is_file() and p.name.startswith("source.")]
            if not videos:
                raise RuntimeError("yt-dlp finished but no downloaded video file was found.")
            video = videos[0]
        if duration <= 0 or duration > MAX_VIDEO_SECONDS:
            raise ValueError(f"Video duration must be between 1 second and {MAX_VIDEO_SECONDS // 3600} hours.")
        title = re.sub(r"[^a-zA-Z0-9_-]+", "_", info.get("title") or "video")[:70].strip("_") or "video"

        update_job(job_id, status="transcribing", progress=35, message="Transcribing audio with Whisper…")
        model = load_model()
        transcript = model.transcribe(str(video), fp16=False, verbose=False)
        segments = transcript.get("segments", [])
        if not segments:
            raise RuntimeError("No speech was detected. This first version needs spoken audio to find highlights.")
        picks = choose_highlights(segments, duration, count, clip_seconds)
        if not picks:
            raise RuntimeError("Could not identify suitable highlight sections.")
        update_job(job_id, status="rendering", progress=65, message="Rendering highlight clips…")
        clip_paths = []
        for index, pick in enumerate(picks, 1):
            out = OUTPUTS / f"{job_id}_{index:02d}.mp4"
            vf = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" if aspect == "9:16" else (
                "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080" if aspect == "1:1" else
                "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2")
            run_command(["ffmpeg", "-y", "-ss", f"{pick['start']:.3f}", "-i", str(video), "-t",
                         f"{pick['end'] - pick['start']:.3f}", "-vf", vf, "-c:v", "libx264",
                         "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k",
                         "-movflags", "+faststart", str(out)])
            clip_paths.append({"name": f"{title}_highlight_{index:02d}.mp4",
                               "file": out.name, "start": round(pick["start"], 2),
                               "end": round(pick["end"], 2), "score": round(pick["score"], 2),
                               "transcript": pick["text"][:500]})
            update_job(job_id, progress=65 + int(30 * index / len(picks)),
                       message=f"Rendered clip {index} of {len(picks)}…")
        manifest = {"source_title": info.get("title"), "source_url": video_url,
                    "duration": duration, "clips": clip_paths,
                    "note": "Highlights are selected using transcript heuristics; review the clips before publishing."}
        (OUTPUTS / f"{job_id}.json").write_text(json.dumps(manifest, indent=2))
        update_job(job_id, status="completed", progress=100, message="Your clips are ready.",
                   title=info.get("title"), clips=clip_paths)
    except Exception as exc:
        cookie_exists = COOKIE_FILE.is_file()
        cookie_size = COOKIE_FILE.stat().st_size if cookie_exists else 0
        cookie_mode = oct(COOKIE_FILE.stat().st_mode & 0o777) if cookie_exists else "missing"
        # Log the real yt-dlp exception for diagnosis, but never log cookie contents.
        logger.exception(
            "Job %s failed. yt-dlp=%s cookie_file_present=%s cookie_file_bytes=%s cookie_file_mode=%s",
            job_id, getattr(yt_dlp.version, "__version__", "unknown"),
            cookie_exists, cookie_size, cookie_mode,
        )
        message = str(exc)
        if "Sign in to confirm" in message or "not a bot" in message.lower():
            message = (
                "YouTube rejected the extraction request. The uploaded cookie file "
                f"{'is present' if cookie_exists else 'is missing'} on the server "
                f"({cookie_size} bytes; permissions {cookie_mode}). "
                "The detailed yt-dlp error is recorded in the youtube-clipper PM2 logs."
            )
        update_job(job_id, status="failed", progress=0, message=message)
    finally:
        if source_path is not None:
            try:
                source_path.unlink(missing_ok=True)
            except OSError:
                logger.warning("Could not remove uploaded source file for job %s", job_id)
        shutil.rmtree(work, ignore_errors=True)


@app.after_request
def security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; media-src 'self'"
    return response


@app.get("/login")
def login_page():
    return render_template("login.html")


@app.post("/login")
def login():
    supplied = request.form.get("password", "")
    ok = check_password_hash(PASSWORD_HASH, supplied) if PASSWORD_HASH else secrets.compare_digest(supplied, PASSWORD) if PASSWORD else False
    if not ok:
        time.sleep(1)
        return render_template("login.html", error="Incorrect password."), 401
    session.clear()
    session["authenticated"] = True
    session["csrf"] = secrets.token_urlsafe(24)
    return redirect(url_for("index"))


@app.post("/logout")
def logout():
    require_login()
    if request.form.get("csrf") != session.get("csrf"):
        abort(403)
    session.clear()
    return redirect(url_for("login_page"))


@app.get("/")
def index():
    if not logged_in():
        return redirect(url_for("login_page"))
    return render_template("index.html", csrf=session["csrf"])


@app.post("/api/jobs")
def create_job():
    require_login()
    if request.headers.get("X-CSRF-Token") != session.get("csrf"):
        abort(403)
    data = request.get_json(silent=True) or {}
    video_url = str(data.get("url", "")).strip()
    if not valid_youtube_url(video_url):
        return jsonify(error="Enter a valid HTTPS YouTube video URL."), 400
    try:
        count = max(1, min(10, int(data.get("count", 3))))
        clip_seconds = max(20, min(90, int(data.get("clip_seconds", 45))))
    except (TypeError, ValueError):
        return jsonify(error="Clip count and length must be numbers."), 400
    aspect = data.get("aspect", "9:16")
    if aspect not in ("9:16", "16:9", "1:1"):
        return jsonify(error="Unsupported aspect ratio."), 400
    job_id = uuid.uuid4().hex
    record = {"id": job_id, "status": "queued", "progress": 0, "message": "Queued…",
              "created": int(time.time()), "clips": []}
    with jobs_lock:
        jobs[job_id] = record
        (JOBS / f"{job_id}.json").write_text(json.dumps(record, indent=2))
    threading.Thread(target=process_video, args=(job_id, video_url, count, clip_seconds, aspect), daemon=True).start()
    return jsonify(id=job_id), 202


@app.get("/youtube/connect")
def youtube_connect():
    require_login()
    flow = make_flow()
    authorization_url, state = flow.authorization_url(
        access_type="offline", include_granted_scopes="true", prompt="consent"
    )
    session["youtube_oauth_state"] = state
    return redirect(authorization_url)


@app.get("/oauth/youtube/callback")
def youtube_callback():
    require_login()
    state = session.pop("youtube_oauth_state", None)
    if not state or request.args.get("state") != state:
        abort(400, "Invalid YouTube authorization state.")
    flow = make_flow(state=state)
    flow.fetch_token(authorization_response=request.url)
    save_credentials(DATA, flow.credentials)
    return redirect(url_for("index") + "?youtube=connected")


def process_scheduled_publish(job_id: str, clip_path: Path, title: str, description: str, publish_at: datetime):
    update_job(job_id, status="uploading", progress=10, message="Uploading clip to YouTube…")
    try:
        result = upload_scheduled_video(DATA, clip_path, title, description, publish_at)
        update_job(job_id, status="published", progress=100,
                   message="Upload complete. YouTube has scheduled this video.",
                   youtube=result)
    except Exception as exc:
        logger.exception("YouTube scheduled upload failed for job %s", job_id)
        update_job(job_id, status="failed", progress=0, message=str(exc)[:500])


@app.post("/api/publish")
def publish_clip():
    require_login()
    if request.headers.get("X-CSRF-Token") != session.get("csrf"):
        abort(403)
    data = request.get_json(silent=True) or {}
    filename = str(data.get("file", ""))
    if not re.fullmatch(r"[a-f0-9]{32}_[0-9]{2}\\.mp4", filename):
        return jsonify(error="Invalid clip file."), 400
    clip_path = OUTPUTS / filename
    if not clip_path.is_file():
        abort(404)
    title = str(data.get("title", "")).strip()
    description = str(data.get("description", "")).strip()
    if not title:
        return jsonify(error="Enter a YouTube title before scheduling."), 400
    try:
        publish_at = datetime.fromisoformat(str(data.get("publish_at", "")).replace("Z", "+00:00"))
        if publish_at.tzinfo is None:
            return jsonify(error="Choose a publication time with a timezone."), 400
        if publish_at <= datetime.now(publish_at.tzinfo):
            return jsonify(error="Choose a publication time in the future."), 400
        job_id = uuid.uuid4().hex
        record = {"id": job_id, "status": "queued", "progress": 0,
                  "message": "Waiting to upload to YouTube…", "created": int(time.time())}
        with jobs_lock:
            jobs[job_id] = record
            (JOBS / f"{job_id}.json").write_text(json.dumps(record, indent=2))
        threading.Thread(target=process_scheduled_publish,
            args=(job_id, clip_path, title, description, publish_at), daemon=True).start()
        return jsonify(id=job_id), 202
    except Exception as exc:
        logger.exception("YouTube scheduled upload failed for %s", filename)
        return jsonify(error=str(exc)[:500]), 400


@app.post("/api/upload")
def upload_source_video():
    require_login()
    if request.headers.get("X-CSRF-Token") != session.get("csrf"):
        abort(403)
    uploaded = request.files.get("video")
    if not uploaded or not uploaded.filename:
        return jsonify(error="Choose a video file to upload."), 400
    suffix = Path(uploaded.filename).suffix.lower()
    if suffix not in {".mp4", ".mov", ".m4v", ".mkv", ".webm"}:
        return jsonify(error="Supported formats: MP4, MOV, M4V, MKV and WebM."), 400
    try:
        count = max(1, min(10, int(request.form.get("count", 3))))
        clip_seconds = max(20, min(90, int(request.form.get("clip_seconds", 45))))
    except (TypeError, ValueError):
        return jsonify(error="Clip count and length must be numbers."), 400
    aspect = request.form.get("aspect", "9:16")
    if aspect not in ("9:16", "16:9", "1:1"):
        return jsonify(error="Unsupported aspect ratio."), 400
    job_id = uuid.uuid4().hex
    source_path = INCOMING / f"{job_id}{suffix}"
    uploaded.save(source_path)
    source_path.chmod(0o600)
    record = {"id": job_id, "status": "queued", "progress": 0,
              "message": "Video uploaded. Queued for processing…",
              "created": int(time.time()), "clips": [], "source_type": "upload"}
    with jobs_lock:
        jobs[job_id] = record
        (JOBS / f"{job_id}.json").write_text(json.dumps(record, indent=2))
    threading.Thread(target=process_video,
        args=(job_id, "", count, clip_seconds, aspect, source_path), daemon=True).start()
    return jsonify(id=job_id), 202


@app.get("/api/jobs/<job_id>")
def job_status(job_id):
    require_login()
    with jobs_lock:
        item = jobs.get(job_id)
    if item is None:
        path = JOBS / f"{job_id}.json"
        if not re.fullmatch(r"[a-f0-9]{32}", job_id) or not path.exists():
            abort(404)
        item = json.loads(path.read_text())
    return jsonify(item)


@app.post("/api/cookies")
def upload_cookies():
    require_login()
    if request.headers.get("X-CSRF-Token") != session.get("csrf"):
        abort(403)
    uploaded = request.files.get("cookies")
    if not uploaded or not uploaded.filename.endswith((".txt", ".cookies")):
        return jsonify(error="Choose a Netscape-format cookie .txt file."), 400
    raw = uploaded.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024 or b"<!DOCTYPE" in raw[:100].upper():
        return jsonify(error="Cookie file is invalid or too large."), 400
    if b" Netscape HTTP Cookie File" not in raw[:500] and b"#HttpOnly_" not in raw[:500]:
        return jsonify(error="This does not look like a Netscape-format cookies file."), 400
    temp = UPLOADS / f".cookies-{secrets.token_hex(8)}"
    temp.write_bytes(raw)
    temp.chmod(0o600)
    temp.replace(COOKIE_FILE)
    COOKIE_FILE.chmod(0o600)
    return jsonify(message="Private cookies saved on this server.")


@app.get("/clips/<path:filename>")
def download_clip(filename):
    require_login()
    if not (len(filename) == 39 and all(ch in "0123456789abcdef" for ch in filename[:32]) and filename[32] == "_" and filename[33:35].isdigit() and filename[35:] == ".mp4"):
        abort(404)
    return send_from_directory(OUTPUTS, filename, as_attachment=True)


@app.get("/health")
def health():
    return jsonify(status="ok")


# Browser companion extension: explicit, user-initiated URL handoff only.
from browser_api import pairing_bp
app.config.update(
    CLIPPER_DATA_DIR=str(DATA),
    CLIPPER_JOBS_DIR=str(JOBS),
    CLIPPER_JOBS=jobs,
    CLIPPER_JOBS_LOCK=jobs_lock,
    CLIPPER_PROCESS_VIDEO=process_video,
    CLIPPER_VALID_YOUTUBE_URL=valid_youtube_url,
)
app.register_blueprint(pairing_bp)


@app.after_request
def browser_extension_cors(response):
    # Allow only browser-extension origins to call the two token/code protected
    # connector endpoints. Never enable wildcard CORS for the authenticated app.
    if request.path in ("/api/browser/pair", "/api/browser/submit"):
        origin = request.headers.get("Origin", "")
        if origin.startswith("chrome-extension://") or origin.startswith("moz-extension://"):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            response.headers["Access-Control-Max-Age"] = "600"
    return response


def run_cloudflare_tunnel():
    """Keep the Quick Tunnel attached to this PM2-managed app process."""
    binary = shutil.which("cloudflared")
    if not binary:
        raise SystemExit("cloudflared is not installed or is missing from PATH.")

    stop_tunnel = threading.Event()
    tunnel_process = [None]

    def launch_tunnel():
        print("[tunnel] Starting Cloudflare Quick Tunnel for http://127.0.0.1:8765", flush=True)
        tunnel_process[0] = subprocess.Popen(
            [binary, "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:8765"],
            stdin=subprocess.DEVNULL,
        )

    def supervise_tunnel():
        while not stop_tunnel.wait(5):
            process = tunnel_process[0]
            if process is not None and process.poll() is not None:
                print(f"[tunnel] cloudflared exited ({process.returncode}); restarting in 5 seconds.", flush=True)
                if stop_tunnel.wait(5):
                    break
                launch_tunnel()

    def shutdown(signum, frame):
        print("[tunnel] Stopping Cloudflare Tunnel with the Clipper.", flush=True)
        stop_tunnel.set()
        process = tunnel_process[0]
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
        raise SystemExit(0)

    launch_tunnel()
    threading.Thread(target=supervise_tunnel, name="cloudflared-supervisor", daemon=True).start()
    import signal
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)


if __name__ == "__main__":
    if not PASSWORD and not PASSWORD_HASH:
        raise SystemExit("Set APP_PASSWORD or APP_PASSWORD_HASH before starting the server.")
    run_cloudflare_tunnel()
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "8765")), debug=False, use_reloader=False)
