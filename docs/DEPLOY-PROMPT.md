# Deploy with your AI assistant

Have an AI agent (a coding agent, a terminal assistant, anything with shell access
to your server)? Copy the box below into it. The prompt is model-agnostic and
self-contained: it takes a bare Linux server to a running OpenHealth Agent —
secrets, containers, TLS, and the optional wearable connections — and stops to
ask you wherever a decision is yours to make.

> Requires: a Linux server with Docker, and a domain name pointed at it.

---

````
You are deploying **OpenHealth Agent** — a self-hosted health companion (Next.js
web app + PostgreSQL + wearable sync service) — on the Linux server you have
shell access to. Repository: https://github.com/openhealth-agent/openhealth-agent
(AGPL-3.0).

Work through the steps in order, verify each one before moving on, and never
fabricate credentials. Where a step says "ask the user", stop and ask.

## Ground rules (do not skip)

- Secrets never appear in chat: generate them straight into the `.env` file and
  show the user only the variable names, never the values.
- The database (5432) and sync service (3001) must stay bound to `127.0.0.1`.
  Only the web app goes behind the reverse proxy.
- Before editing any existing file, save a dated backup next to it
  (`file.bak.YYYYMMDD-HHMMSS`).
- If anything already listens on ports 3000, 5432 or 3001, stop and report —
  do not kill or replace it.
- Open firewall ports only after asking the user, and only 80/443 (plus SSH if
  it is already open).
- Do not weaken SSH, disable the firewall, or run `curl | sh` installers without
  asking first.
- This stack stores sensitive health data. It is single-tenant — one deployment
  per person — so keep `.env` and the server private.

## 1. Preconditions

- Check Linux, `docker --version`, `docker compose version`. If Docker is
  missing, ask before installing it the documented way for this distro.
- Ask the user for the domain name that points (or will point) at this server —
  it is required for HTTPS and the wearable OAuth callbacks.
- Verify DNS: `getent hosts <domain>` returns this server's public IP.

## 2. Get the code

```bash
git clone https://github.com/openhealth-agent/openhealth-agent.git ~/openhealth-agent
cd ~/openhealth-agent
```

## 3. Configure — no code edits, everything is env vars

```bash
cp .env.example .env
```

Generate these straight into `.env`, without displaying the values:

| Variable | Generate with |
|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `AUTH_SECRET` | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | `openssl rand -hex 16` |
| `SYNC_API_KEY` | `openssl rand -hex 32` |

Set the URLs (replace `<domain>`):

```
NEXTAUTH_URL=https://<domain>
NEXT_PUBLIC_URL=https://<domain>
PUBLIC_BASE_URL=https://<domain>
WHOOP_REDIRECT_URI=https://<domain>/api/whoop/callback
WITHINGS_REDIRECT_URI=https://<domain>/api/withings/callback
```

Ask the user for an LLM API key (Anthropic recommended) and write it to
`ANTHROPIC_API_KEY`; keep `DEFAULT_CHAT_MODEL` at `claude-opus-5-5` unless they
say otherwise. The bundled compose file wires `ANTHROPIC_API_KEY` into the app —
if the user prefers another provider, add their key variable to the `app`
service's `environment:` block in `docker-compose.yaml` as well.

## 4. Wearables — optional, ask: now or later?

WHOOP and Withings need free developer apps; follow `docs/WHOOP-SETUP.md` and
`docs/WITHINGS-SETUP.md` in the repo, then fill `WHOOP_CLIENT_ID` /
`WHOOP_CLIENT_SECRET` and `WITHINGS_CLIENT_ID` / `WITHINGS_CLIENT_SECRET` in
`.env`. The stack runs fine without them (demo data).

## 5. Build or pull — ask the user; pulling is faster

- **Pull (recommended):** in `docker-compose.yaml`, replace the `app` service's
  `build:` block with:

  ```yaml
  image: ghcr.io/openhealth-agent/openhealth-agent:v0.3.0
  ```

- **Build:** leave the file as-is and run `docker compose up -d --build`
  (builds from `Containerfile`).

The small `whoop-sync` service builds locally either way.

## 6. Start

```bash
docker compose up -d
docker compose ps    # wait until every service reports healthy
```

The app's health check hits its own homepage; the first boot can take a couple
of minutes.

## 7. HTTPS

Terminate TLS in nginx/Caddy/Traefik and proxy to `127.0.0.1:3000` — the app must
not be exposed on `:3000` directly. A ready-made nginx server block (including
the `/api/whoop/` → `:3001` route used by the wearables) is in
`docs/SELF-HOSTING.md`. Get a certificate (e.g. `certbot --nginx -d <domain>`)
and reload the proxy.

## 8. Verify

- `curl -fsS http://127.0.0.1:3000/` on the server returns HTTP 200
- `https://<domain>` serves the login page over valid TLS
- The user can create an account and sign in
- Optional: load the synthetic demo data (`demo/seed-demo-data.sql`, steps in
  `demo/README.md`) to see a populated dashboard

## 9. Report back

End with a short summary: what runs where, the URL, which optional pieces were
skipped, where `.env` lives, and how to update later:

```bash
cd ~/openhealth-agent && git pull && docker compose up -d --build
```

(or, with the pulled image: bump the tag, then `docker compose pull app &&
docker compose up -d`).

Remind the user that `.env` holds live secrets — never commit or share it.

## If something breaks

- Recent logs only: `docker compose logs --since 10 minutes ago app | tail -50`
- Port conflict: `ss -ltnp | grep -E '3000|5432|3001'`
- App unhealthy while the database is fine is almost always a missing or empty
  env var — diff `.env` against `.env.example`
````
