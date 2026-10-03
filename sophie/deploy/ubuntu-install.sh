#!/usr/bin/env bash
set -euo pipefail
APP_DIR=${SOPHIE_APP_DIR:-/home/ubuntu/sophie}
REPO=${SOPHIE_REPO:-https://github.com/Crypto-Daily/PremierPredictApp.git}
BRANCH=${SOPHIE_BRANCH:-main}
cd /home/ubuntu
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO" PremierPredictApp
fi
cd "$APP_DIR"
npm ci --omit=dev
mkdir -p data workspace logs backups
if command -v pm2 >/dev/null 2>&1; then
  pm2 startOrReload ecosystem.config.cjs --update-env
  pm2 save
else
  echo "PM2 is not installed. Install it with: npm install -g pm2"
  exit 2
fi
echo "Sophie deployed from $BRANCH. Check with: pm2 status && pm2 logs sophie --lines 50"
