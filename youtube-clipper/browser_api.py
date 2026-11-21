"""Secure one-time pairing and explicit YouTube-cookie import for the Clipper extension.

The extension only reads cookies scoped to youtube.com after the user clicks
Import. It never reads cookies for unrelated sites or sends them anywhere else.
"""
from __future__ import annotations

import hashlib
import secrets
import threading
import time
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
    return jsonify(token=token, message="Browser paired. You can now import your YouTube cookies.")


@pairing_bp.post("/api/browser/import-cookies")
def import_youtube_cookies():
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
    cookie_text = data.get("cookies")
    if not isinstance(cookie_text, str) or len(cookie_text.encode("utf-8")) > 1024 * 1024:
        return jsonify(error="Cookie data is missing or exceeds the 1 MB limit."), 400

    lines = cookie_text.splitlines()
    valid_rows = []
    for line in lines:
        if not line or line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) != 7:
            return jsonify(error="Invalid Netscape cookie data."), 400
        domain, include_subdomains, path, secure, expiry, name, value = fields
        clean_domain = domain.removeprefix("#HttpOnly_").lstrip(".").lower()
        if clean_domain != "youtube.com" and not clean_domain.endswith(".youtube.com"):
            return jsonify(error="Only cookies scoped to youtube.com are accepted."), 400
        if any("\n" in field or "\r" in field for field in fields):
            return jsonify(error="Invalid cookie field."), 400
        valid_rows.append(line)

    if not valid_rows:
        return jsonify(error="No YouTube login cookies were found. Sign in to YouTube in Edge and try again."), 400

    cookie_file = Path(current_app.config["CLIPPER_COOKIE_FILE"])
    cookie_file.parent.mkdir(parents=True, exist_ok=True)
    content = "# Netscape HTTP Cookie File\n" + "\n".join(valid_rows) + "\n"
    temp = cookie_file.with_name(".youtube-cookies-" + secrets.token_hex(8))
    temp.write_text(content, encoding="utf-8")
    temp.chmod(0o600)
    temp.replace(cookie_file)
    cookie_file.chmod(0o600)
    return jsonify(message="YouTube cookies imported and stored privately on the Clipper server.",
                   cookie_count=len(valid_rows))
