#!/usr/bin/env bash
set -Eeuo pipefail
COMFY_DIR="${COMFYUI_DIR:-$HOME/ComfyUI}"
if [[ ! -f "$COMFY_DIR/main.py" ]]; then echo "ComfyUI not found at $COMFY_DIR. Run scripts/setup-local-ai.sh first." >&2; exit 1; fi
PY="$COMFY_DIR/.venv/bin/python"
[[ -x "$PY" ]] || PY="$(command -v python3)"
exec "$PY" "$COMFY_DIR/main.py" --listen 127.0.0.1 --port 8188
