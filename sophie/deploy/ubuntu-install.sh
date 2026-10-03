#!/usr/bin/env bash
set -euo pipefail

# Sophie uses a staging checkout first. Never git-reset the live runtime.
LIVE_DIR="${SOPHIE_APP_DIR:-/home/ubuntu/sophie}"
STAGE_ROOT="${SOPHIE_STAGE_DIR:-/home/ubuntu/sophie-stage}"
REPO="${SOPHIE_REPO:-https://github.com/Crypto-Daily/PremierPredictApp.git}"
BRANCH="${SOPHIE_BRANCH:-main}"
STAGE_REPO="$STAGE_ROOT/PremierPredictApp"

mkdir -p "$STAGE_ROOT"
if [ -d "$STAGE_REPO/.git" ]; then
  git -C "$STAGE_REPO" fetch origin "$BRANCH"
  git -C "$STAGE_REPO" checkout "$BRANCH"
  git -C "$STAGE_REPO" reset --hard "origin/$BRANCH"
else
  rm -rf "$STAGE_REPO"
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$STAGE_REPO"
fi

cd "$STAGE_REPO/sophie"
npm ci
npm run check
npm test

mkdir -p "$LIVE_DIR" "$LIVE_DIR/data" "$LIVE_DIR/workspace" "$LIVE_DIR/logs" "$LIVE_DIR/backups"

# Copy only after the staging checkout passes verification.
# Runtime state and secrets stay in the live directory.
rsync -a --delete \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude 'data/' \
  --exclude 'workspace/' \
  --exclude 'logs/' \
  --exclude 'backups/' \
  "$STAGE_REPO/sophie/" "$LIVE_DIR/"

cd "$LIVE_DIR"
if command -v pm2 >/dev/null 2>&1; then
  pm2 startOrReload ecosystem.config.cjs --update-env
  pm2 save
else
  echo "PM2 is not installed. Install it with: npm install -g pm2"
  exit 2
fi

echo "Sophie staged deployment completed."
echo "Live:  $LIVE_DIR"
echo "Stage: $STAGE_REPO"
echo "Commit: $(git -C "$STAGE_REPO" rev-parse --short HEAD)"
echo "Check: pm2 status && pm2 logs sophie --lines 50"
