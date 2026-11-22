from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


def token_path(data_dir: Path) -> Path:
    return data_dir / "private" / "youtube-token.json"


def client_secrets_path() -> Path:
    value = os.environ.get("YOUTUBE_CLIENT_SECRETS", "")
    if not value:
        raise RuntimeError("Set YOUTUBE_CLIENT_SECRETS to your Google OAuth client JSON file.")
    path = Path(value).expanduser().resolve()
    if not path.is_file():
        raise RuntimeError(f"Google OAuth client file was not found: {path}")
    return path


def redirect_uri() -> str:
    value = os.environ.get("YOUTUBE_REDIRECT_URI", "").strip()
    if not value:
        raise RuntimeError("Set YOUTUBE_REDIRECT_URI to your public HTTPS callback URL.")
    return value


def make_flow(state: str | None = None) -> Flow:
    flow = Flow.from_client_secrets_file(
        str(client_secrets_path()),
        scopes=SCOPES,
        state=state,
    )
    flow.redirect_uri = redirect_uri()
    return flow


def load_credentials(data_dir: Path) -> Credentials:
    path = token_path(data_dir)
    if not path.is_file():
        raise RuntimeError("YouTube is not connected yet. Connect your channel first.")
    creds = Credentials.from_authorized_user_file(str(path), SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        save_credentials(data_dir, creds)
    if not creds.valid:
        raise RuntimeError("YouTube authorization expired. Please connect your channel again.")
    return creds


def save_credentials(data_dir: Path, creds: Credentials) -> None:
    path = token_path(data_dir)
    temp = path.with_suffix(".tmp")
    temp.write_text(creds.to_json(), encoding="utf-8")
    temp.chmod(0o600)
    temp.replace(path)
    path.chmod(0o600)


def upload_scheduled_video(
    data_dir: Path,
    video_path: Path,
    title: str,
    description: str,
    publish_at: datetime,
) -> dict:
    if publish_at.tzinfo is None:
        raise ValueError("Choose a publication time with a timezone.")
    publish_at = publish_at.astimezone(timezone.utc)
    if publish_at <= datetime.now(timezone.utc):
        raise ValueError("Scheduled publication must be in the future.")
    creds = load_credentials(data_dir)
    youtube = build("youtube", "v3", credentials=creds, cache_discovery=False)
    body = {
        "snippet": {
            "title": title[:100],
            "description": description[:5000],
            "categoryId": "22",
        },
        "status": {
            "privacyStatus": "private",
            "publishAt": publish_at.isoformat(timespec="seconds").replace("+00:00", "Z"),
        },
    }
    media = MediaFileUpload(str(video_path), mimetype="video/mp4", chunksize=8 * 1024 * 1024, resumable=True)
    request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)
    response = None
    while response is None:
        _, response = request.next_chunk()
    return {
        "video_id": response.get("id"),
        "url": f"https://www.youtube.com/watch?v={response.get('id')}",
        "scheduled_for": body["status"]["publishAt"],
        "privacy_status": "private",
    }
