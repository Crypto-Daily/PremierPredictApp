#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMFY_DIR="${COMFYUI_DIR:-$HOME/ComfyUI}"
echo "=== Local AI capability check ==="
python3 --version
if command -v nvidia-smi >/dev/null 2>&1; then nvidia-smi || true; else echo "No NVIDIA GPU detected. CPU inference may be very slow; inspect RAM and available disk before choosing a model."; fi
echo
echo "This script installs ComfyUI itself but does not download a model checkpoint."
echo "Model weights can be several GB and compatibility depends on your server RAM/GPU."
if [[ -e "$COMFY_DIR" ]]; then
  echo "ComfyUI directory already exists: $COMFY_DIR"
  echo "Not overwriting it. Update/install it manually if needed."
  exit 0
fi
if ! command -v git >/dev/null 2>&1; then echo "git is required." >&2; exit 1; fi
git clone https://github.com/comfyanonymous/ComfyUI.git "$COMFY_DIR"
python3 -m venv "$COMFY_DIR/.venv"
"$COMFY_DIR/.venv/bin/python" -m pip install --upgrade pip
if command -v nvidia-smi >/dev/null 2>&1; then
  echo "NVIDIA GPU detected. Install the PyTorch build matching the installed CUDA driver per https://pytorch.org/get-started/locally/ before installing ComfyUI requirements."
  echo "Then run: $COMFY_DIR/.venv/bin/pip install -r $COMFY_DIR/requirements.txt"
else
  echo "Installing CPU PyTorch and ComfyUI requirements. This can be slow and may need substantial disk/RAM."
  "$COMFY_DIR/.venv/bin/pip" install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
  "$COMFY_DIR/.venv/bin/pip" install -r "$COMFY_DIR/requirements.txt"
fi
echo
echo "ComfyUI installed at $COMFY_DIR."
echo "Next: place a compatible checkpoint under $COMFY_DIR/models/checkpoints/ and configure config/comfyui-workflow.example.json."
echo "Start local ComfyUI with:"
echo "  $COMFY_DIR/.venv/bin/python $COMFY_DIR/main.py --listen 127.0.0.1 --port 8188"
