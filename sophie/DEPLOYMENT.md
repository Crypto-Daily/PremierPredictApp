# Sophie production deployment — Ubuntu 22.04

The canonical runtime is `/home/ubuntu/sophie` and the production process is managed by PM2 as `sophie`.

## Required environment

Create or preserve `/home/ubuntu/sophie/.env`. Do not commit it.

At minimum in production:
- `NODE_ENV=production`
- `PORT=3100`
- `SOPHIE_ACCESS_PASSWORD=<strong private password>`

Configure provider/API variables required by the existing provider router and Hermes installation as appropriate for the server.

## Deploy

From the Ubuntu server:

```bash
cd /home/ubuntu
export SOPHIE_APP_DIR=/home/ubuntu/sophie
export SOPHIE_BRANCH=main
bash "$SOPHIE_APP_DIR/deploy/ubuntu-install.sh"
```

The script fetches the canonical GitHub `main` branch, installs locked dependencies, preserves runtime data/.env, and starts or reloads PM2.

## Verify

```bash
pm2 status
pm2 logs sophie --lines 100
curl -s http://127.0.0.1:3100/
curl -s http://127.0.0.1:3100/api/access/status
```

The browser UI will request the access password before calling protected APIs.

## Updating an existing installation

```bash
cd /home/ubuntu/sophie
git fetch origin main
git reset --hard origin/main
npm ci --omit=dev
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

Runtime data under `data/`, workspace artifacts, backups and `.env` are not replaced by the Git update.

## Public tunnel

If Cloudflare Tunnel is used, point the tunnel at `http://127.0.0.1:3100`. The `trycloudflare.com` quick-tunnel URL is a temporary Cloudflare tunnel address; use a named tunnel for a stable production hostname.
