#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

echo "=== Clipper setup ==="
echo "This configures the existing Clipper app. It does not create a new PM2 process."

if [[ ! -x ".venv/bin/python" ]]; then
  echo "ERROR: Python virtual environment not found at $APP_DIR/.venv"
  exit 1
fi

if [[ -f ".env" ]]; then
  echo "An existing .env file was found."
  read -r -p "Replace its Clipper login and WhatsApp settings? [y/N] " replace_env
  if [[ ! "$replace_env" =~ ^[Yy]$ ]]; then
    echo "Keeping the existing .env file."
    configure_env=0
  else
    configure_env=1
  fi
else
  configure_env=1
fi

if [[ "$configure_env" -eq 1 ]]; then
  read -r -s -p "Create your private Clipper login password (at least 12 characters): " APP_PASSWORD
  echo
  if (( ${#APP_PASSWORD} < 12 )); then
    echo "ERROR: Password must contain at least 12 characters."
    unset APP_PASSWORD
    exit 1
  fi

  read -r -p "WhatsApp number that should RECEIVE clips (international format, digits only): " WHATSAPP_PHONE_NUMBER
  WHATSAPP_PHONE_NUMBER="${WHATSAPP_PHONE_NUMBER//[^0-9]/}"
  if (( ${#WHATSAPP_PHONE_NUMBER} < 10 || ${#WHATSAPP_PHONE_NUMBER} > 15 )); then
    echo "ERROR: Enter a valid international number including country code."
    unset APP_PASSWORD
    exit 1
  fi

  export APP_PASSWORD WHATSAPP_PHONE_NUMBER
  .venv/bin/python - <<'PY'
from pathlib import Path
from getpass import getpass
import json, os, secrets

folder = Path.cwd()
def q(value):
    return json.dumps(value, ensure_ascii=False)

settings = {
    "APP_PASSWORD": os.environ["APP_PASSWORD"],
    "SECRET_KEY": secrets.token_urlsafe(48),
    "COOKIE_SECURE": "1",
    "PORT": "8765",
    "CLIPPER_DATA": str(folder / "data"),
    "WHISPER_MODEL": "base",
    "WHATSAPP_PHONE_NUMBER": os.environ["WHATSAPP_PHONE_NUMBER"],
    "MAX_UPLOAD_BYTES": "1073741824",
    "WHATSAPP_INTERNAL_PORT": "8766",
}
env_path = folder / ".env"
lines = [f"{key}={q(value)}" for key, value in settings.items()]
env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
env_path.chmod(0o600)
(folder / "data").mkdir(parents=True, exist_ok=True)
(folder / "data").chmod(0o700)
print("Private settings saved in .env (permissions 600).")
PY
  unset APP_PASSWORD WHATSAPP_PHONE_NUMBER
fi

echo "=== Installing Node dependencies ==="
npm install --omit=dev

echo "=== Installing Python dependencies ==="
.venv/bin/pip install -r requirements.txt

echo "=== Checking application syntax ==="
.venv/bin/python -m py_compile app.py
node --check whatsapp.js
node --check static/app.js

echo "=== Restarting the existing PM2 Clipper process (ID 6) ==="
pm2 restart 6 --update-env

echo "=== PM2 status ==="
pm2 status

echo "=== Recent Clipper logs ==="
pm2 logs 6 --lines 40 --nostream

echo "Setup finished. Open the existing Clipper URL and pair its dedicated WhatsApp session using the QR shown in the app."
