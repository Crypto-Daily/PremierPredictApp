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

Sophie is deployed through a **staging checkout**. The live directory is never used for Git resets.

Defaults:
- Live: `/home/ubuntu/sophie`
- Staging: `/home/ubuntu/sophie-stage/PremierPredictApp/sophie`

You can override the staging location with `SOPHIE_STAGE_DIR`.

Run:

```bash
cd /home/ubuntu/sophie
export SOPHIE_APP_DIR=/home/ubuntu/sophie
export SOPHIE_STAGE_DIR=/home/ubuntu/sophie-stage
export SOPHIE_BRANCH=main
bash "$SOPHIE_APP_DIR/deploy/ubuntu-install.sh"
```

The deployment process is:

1. Pull `main` into the staging checkout.
2. Install dependencies in staging.
3. Run `npm run check`.
4. Run `npm test`.
5. Only if both pass, synchronize the Sophie application into the live directory.
6. Preserve the live `.env`, `data/`, `workspace/`, `logs/`, and `backups/`.
7. Reload PM2.

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
