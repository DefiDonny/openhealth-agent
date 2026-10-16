# Self-Hosting Guide

Run the whole stack — app, database and wearable sync service — with Docker
Compose. Expect about 10 minutes end to end.

## 1. Requirements

- A Linux server with Docker and Docker Compose (a $5–10/month VPS is plenty)
- A domain name pointed at the server (needed for HTTPS and OAuth callbacks)
- Optional but recommended: a WHOOP and/or Withings account

## 2. Configure

```bash
git clone https://github.com/OWNER/openhealth-agent.git
cd openhealth-agent
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Notes |
|---|---|
| `POSTGRES_PASSWORD` | Pick a strong random password. |
| `AUTH_SECRET` | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | `openssl rand -hex 16` — keep it safe; it encrypts stored provider keys. |
| `NEXTAUTH_URL` / `PUBLIC_BASE_URL` | `https://your-domain.example` |
| `SYNC_API_KEY` | `openssl rand -hex 32` — required for the sync service in containers. |
| `WHOOP_*` / `WITHINGS_*` | Optional — see [WHOOP-SETUP.md](WHOOP-SETUP.md) and [WITHINGS-SETUP.md](WITHINGS-SETUP.md). |

## 3. Start

```bash
docker compose up -d --build
```

That starts:

- **database** — PostgreSQL, bound to `127.0.0.1:5432`
- **app** — the OpenHealth Agent web app, bound to `127.0.0.1:3000`
- **whoop-sync** — wearable sync service, bound to `127.0.0.1:3001`,
  with an **internal daily scheduler** (02:00 UTC by default; tune with
  `SYNC_CRON_UTC_HOUR`)

All ports bind to localhost on purpose. Expose the app through a reverse proxy
(nginx/Caddy/Traefik) that terminates TLS — do not publish port 3000 directly.

### nginx example

```nginx
server {
    server_name your-domain.example;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        client_max_body_size 50M;
    }

    location /api/whoop/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/withings/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then get TLS with `certbot --nginx -d your-domain.example`.

> Why do `/api/whoop/*` and `/api/withings/*` bypass the app? Those are the OAuth
> callback endpoints the wearable providers redirect to. Everything else goes
> through the app, which handles login.

## 4. First run

1. Open `https://your-domain.example` and create the admin account.
2. (Optional) Seed the [demo data](../demo/README.md) to see the dashboard with
   charts before connecting anything real.
3. Connect WHOOP / Withings via the setup guides.

## 5. Operations

```bash
docker compose logs -f --tail 50        # logs
docker compose pull && docker compose up -d --build   # upgrade
```

**Backups** — these two are irreplaceable:

```bash
docker compose exec -T database pg_dump -U openhealth openhealth > backup-$(date +%F).sql
tar czf sync-tokens-$(date +%F).tgz -C /var/lib/docker/volumes openhealth-agent_sync_tokens 2>/dev/null
```

(Or back up the `postgres_data` and `sync_tokens` Docker volumes with your usual
volume backup tool.)

## Security notes

- Everything binds to `127.0.0.1` except inside the compose network.
- The sync service accepts requests from localhost or with `X-Sync-Key`
  (`SYNC_API_KEY`); the browser reaches it only through the app's authenticated
  relay at `/api/integrations/*`.
- Uploads require a logged-in session. OAuth callbacks are state-protected.
- Keep `.env` out of git (it is gitignored) and never paste its contents into
  issues or screenshots.

## Troubleshooting

| Symptom | Fix |
|---|---|
| App starts but login fails | `NEXTAUTH_URL` must match the public URL exactly (https included). |
| OAuth `redirect_uri mismatch` | Provider app settings must match `WHOOP_REDIRECT_URI` / `WITHINGS_REDIRECT_URI`. |
| Sync service `unauthorized` | Set `SYNC_API_KEY` in `.env` and restart — the app relay needs it. |
| Sync service can't reach the database | Inside compose it uses `POSTGRES_HOST=database`; on bare metal use `localhost`. |
| Uploads rejected | Filenames must be `*.pdf`, `*.png` or `*.jpg/jpeg`. |
