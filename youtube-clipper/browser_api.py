"""Pair a local browser extension with the private clipper instance.

The extension only submits the active YouTube URL after an explicit user click.
It never reads, exports, or transmits browser cookies.
"""
from __future__ import annotations

import hashlib
import json
import secrets
import threading
import time
import uuid
from pathlib import Path

from flask import Blueprint, abort, current_app, jsonify, request, session

pairing_bp = Blueprint("browser_pairing", __name__)
_pairing_lock = threading.Lock()
_pairing_codes: dict[str, float] = {}


def _token_path() -> Path:
    return Path(current_app.config["CLIPPER_DATA_DIR"]) / "private" / "browser-extension-token.sha256"


def _csrf_ok() -> bool:
    return request.headers.get("X-CSRF-Token") == session.get("csrf")


@pairing_bp.post("/api/browser/pairing")
def create_pairing_code():
    if session.get("authenticated") is not True:
        abort(401)
    if not _csrf_ok():
        abort(403)
    code = secrets.token_urlsafe(18)
    with _pairing_lock:
        now = time.time()
        for old_code, expiry in list(_pairing_codes.items()):
            if expiry <= now:
                _pairing_codes.pop(old_code, None)
        _pairing_codes[code] = now + 600
    return jsonify(code=code, expires_in=600)


@pairing_bp.post("/api/browser/pair")
def pair_extension():
    data = request.get_json(silent=True) or {}
    code = str(data.get("code", ""))
    with _pairing_lock:
        expiry = _pairing_codes.pop(code, None)
    if not expiry or expiry < time.time():
        return jsonify(error="Pairing code is invalid or expired. Generate a new code in Clipper Settings."), 401

    token = secrets.token_urlsafe(40)
    token_file = _token_path()
    token_file.parent.mkdir(parents=True, exist_ok=True)
    temp = token_file.with_suffix(".tmp")
    temp.write_text(hashlib.sha256(token.encode("utf-8")).hexdigest(), encoding="ascii")
    temp.chmod(0o600)
    temp.replace(token_file)
    token_file.chmod(0o600)
    return jsonify(token=token, message="Browser extension paired. Keep this token private.")


@pairing_bp.post("/api/browser/submit")
def submit_active_video():
    supplied = request.headers.get("Authorization", "")
    if not supplied.startswith("Bearer "):
        abort(401)
    token = supplied[7:].strip()
    token_file = _token_path()
    if not token or not token_file.exists():
        abort(401)
    expected = token_file.read_text(encoding="ascii").strip()
    actual = hashlib.sha256(token.encode("utf-8")).hexdigest()
    if not secrets.compare_digest(actual, expected):
        abort(401)

    data = request.get_json(silent=True) or {}
    video_url = str(data.get("url", "")).strip()
    if not current_app.config["CLIPPER_VALID_YOUTUBE_URL"](video_url):
        return jsonify(error="The active tab is not a supported HTTPS YouTube video URL."), 400
    try:
        count = max(1, min(10, int(data.get("count", 3))))
        clip_seconds = max(20, min(90, int(data.get("clip_seconds", 45))))
    except (TypeError, ValueError):
        return jsonify(error="Clip count and length must be numbers."), 400
    aspect = data.get("aspect", "9:16")
    if aspect not in ("9:16", "16:9", "1:1"):
        return jsonify(error="Unsupported aspect ratio."), 400

    job_id = uuid.uuid4().hex
    record = {"id": job_id, "status": "queued", "progress": 0,
              "message": "Queued from your browser…", "created": int(time.time()), "clips": []}
    jobs = current_app.config["CLIPPER_JOBS"]
    jobs_lock = current_app.config["CLIPPER_JOBS_LOCK"]
    jobs_dir = Path(current_app.config["CLIPPER_JOBS_DIR"])
    with jobs_lock:
        jobs[job_id] = record
        (jobs_dir / f"{job_id}.json").write_text(json.dumps(record, indent=2))
    worker = threading.Thread(
        target=current_app.config["CLIPPER_PROCESS_VIDEO"],
        args=(job_id, video_url, count, clip_seconds, aspect),
        daemon=True,
    )
    worker.start()
    return jsonify(id=job_id, message="Video sent to Clipper."), 202
