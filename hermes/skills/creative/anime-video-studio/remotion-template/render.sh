#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PROPS_FILE="${1:-props.json}"
OUTPUT_FILE="${2:-out/anime-preview.mp4}"
mkdir -p "$(dirname "$OUTPUT_FILE")"

BROWSER="${REMOTION_BROWSER_EXECUTABLE:-}"
EXPECTED_BROWSER="$ROOT/node_modules/.remotion/chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell"
BROWSER_ZIP="$ROOT/node_modules/.remotion/chrome-headless-shell/chrome-headless-shell-linux64.zip"

# Remotion may download its browser archive but fail to extract it in some environments.
if [[ -z "$BROWSER" && ! -x "$EXPECTED_BROWSER" && -s "$BROWSER_ZIP" ]] && command -v unzip >/dev/null 2>&1; then
  echo "Extracting Remotion's downloaded Chrome Headless Shell..."
  unzip -oq "$BROWSER_ZIP" -d "$ROOT/node_modules/.remotion/chrome-headless-shell"
  chmod +x "$EXPECTED_BROWSER" 2>/dev/null || true
fi

if [[ -z "$BROWSER" && -x "$EXPECTED_BROWSER" ]]; then
  BROWSER="$EXPECTED_BROWSER"
fi

# Fall back to a cached Playwright browser or a system-installed browser.
if [[ -z "$BROWSER" ]]; then
  for candidate in \
    "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell \
    "$(command -v chromium 2>/dev/null || true)" \
    "$(command -v chromium-browser 2>/dev/null || true)" \
    "$(command -v google-chrome 2>/dev/null || true)" \
    "$(command -v google-chrome-stable 2>/dev/null || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      BROWSER="$candidate"
      break
    fi
  done
fi

if [[ -z "$BROWSER" || ! -x "$BROWSER" ]]; then
  echo "ERROR: No executable Chromium/Chrome browser found." >&2
  echo "Install/ensure a Remotion browser, or set REMOTION_BROWSER_EXECUTABLE to its executable path." >&2
  exit 1
fi

PROPS_ARGS=()
if [[ -f "$PROPS_FILE" ]]; then
  PROPS_ARGS+=(--props-file="$PROPS_FILE")
else
  echo "No props file at '$PROPS_FILE'; rendering the template's built-in demo storyboard."
fi

echo "Using browser: $BROWSER"
npx remotion render src/index.jsx AnimeVideo "$OUTPUT_FILE" "${PROPS_ARGS[@]}" --browser-executable="$BROWSER"
echo "Rendered video: $OUTPUT_FILE"
