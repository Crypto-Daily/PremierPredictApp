from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

import whisper
import yt_dlp
from flask import Flask, abort, jsonify, redirect, render_template, request, send_from_directory, session, url_for
from werkzeug.security import check_password_hash

BASE = Path(__file__).resolve().parent
DATA = Path(os.environ.get("CLIPPER_DATA", BASE / "data")).resolve()
JOBS = DATA / "jobs"
OUTPUTS = DATA / "clips"
UPLOADS = DATA / "private"
for folder in (JOBS, OUTPUTS, UPLOADS):
    folder.mkdir(parents=True, exist_ok=True)
    try:
        folder.chmod(0o700)
    except OSError:
        pass

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                  SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "1") == "1",
                  MAX_CONTENT_LENGTH=2 * 1024 * 1024)
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


def process_video(job_id: str, video_url: str, count: int, clip_seconds: int, aspect: str):
    work = JOBS / job_id
    work.mkdir(parents=True, exist_ok=True)
    try:
        update_job(job_id, status="downloading", progress=5, message="Getting video information…")
        info_opts = {"quiet": True, "no_warnings": True, "noplaylist": True, "socket_timeout": 30}
        if COOKIE_FILE.exists():
            info_opts["cookiefile"] = str(COOKIE_FILE)
        with yt_dlp.YoutubeDL(info_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)
        duration = float(info.get("duration") or 0)
        if duration <= 0 or duration > MAX_VIDEO_SECONDS:
            raise ValueError(f"Video duration must be between 1 second and {MAX_VIDEO_SECONDS // 3600} hours.")
        title = re.sub(r"[^a-zA-Z0-9_-]+", "_", info.get("title") or "video")[:70].strip("_") or "video"
        source = work / "source.%(ext)s"
        opts = {"format": "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b", "outtmpl": str(source),
                "merge_output_format": "mp4", "quiet": True, "no_warnings": True, "noplaylist": True}
        if COOKIE_FILE.exists():
            opts["cookiefile"] = str(COOKIE_FILE)
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([video_url])
        videos = [p for p in work.iterdir() if p.is_file() and p.name.startswith("source.")]
        if not videos:
            raise RuntimeError("yt-dlp finished but no downloaded video file was found.")
        video = videos[0]

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
        message = str(exc)
        if "Sign in to confirm" in message or "not a bot" in message.lower():
            message = "YouTube requires an authenticated session for this video. Export your own browser cookies in Netscape format and upload them in Settings; the cookie file stays private on this server."
        update_job(job_id, status="failed", progress=0, message=message)
    finally:
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


if __name__ == "__main__":
    if not PASSWORD and not PASSWORD_HASH:
        raise SystemExit("Set APP_PASSWORD or APP_PASSWORD_HASH before starting the server.")
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "8765")), debug=False)
