# WHOOP Setup Guide

Every installation connects to WHOOP through **its own WHOOP developer app**. The
client ID and secret are per-install credentials — there is nothing to share and
nothing to hardcode. This guide walks through the WHOOP account side, which cannot
be automated.

## 1. Create your WHOOP developer app

1. Go to <https://developer.whoop.com> and sign in with your WHOOP account.
2. **Create Application** — any name and description (e.g. "My Health Hub").
3. **Redirect URI** — must match exactly:
   `https://YOUR-DOMAIN/api/whoop/callback`
4. Save. Copy the **Client ID** and **Client Secret**.

Scopes used by this project: recovery, cycles, workouts, sleep, profile
(`read:recovery read:cycles read:workout read:sleep read:profile`, plus `offline`
for refresh tokens). Body-measurement/SpO2 access is requested for compatibility
but the data is deliberately ignored — WHOOP weight and SpO2 are unreliable and
excluded from the dashboard.

## 2. Configure

Add to `.env` (see `.env.example`):

```bash
PUBLIC_BASE_URL=https://your-domain.example
WHOOP_CLIENT_ID=your-client-id
WHOOP_CLIENT_SECRET=your-client-secret
WHOOP_REDIRECT_URI=https://your-domain.example/api/whoop/callback
SYNC_API_KEY=a-long-random-string
```

Then restart the sync service (`sudo systemctl restart whoop-sync`, or
`docker compose restart whoop-sync` in the containerized setup).

## 3. Connect

While logged into the hub, open:

```
https://YOUR-DOMAIN/api/integrations/whoop/connect
```

You are redirected to WHOOP, asked to authorize, and land on a
"WHOOP Connected Successfully" page. The first sync runs immediately.

Verify from the server:

```bash
curl -s http://localhost:3001/api/whoop/status
# {"connected":true,"last_sync":"...","token_updated":"..."}
```

## 4. Daily sync

Add the cron entry (adjust the path):

```cron
0 23 * * * /path/to/whoop-sync/sync-cron.sh >> /var/log/whoop-sync.log 2>&1
```

## What the sync does

- **First sync** fetches roughly the last 4 months; **daily syncs** fetch the last
  7 days.
- History is **merged, never overwritten**: records are deduplicated by date and
  accumulated (about 120 days kept per series).
- Sleep, recovery, cycles and workouts are stored compactly. SpO2 and
  WHOOP-derived weight are excluded (unreliable).
- Access tokens refresh automatically when expired.

## Security notes

- The sync service's `/connect`, `/status` and `/sync` endpoints accept **localhost
  or the `X-Sync-Key` header only**. The browser reaches them through the hub's
  authenticated relay at `/api/integrations/whoop/*`.
- OAuth callbacks require a matching `state` value (CSRF protection). If the sync
  service restarts between clicking Connect and returning from WHOOP, the state is
  lost — just click Connect again.
- Tokens are stored in `TOKEN_FILE` (default `./tokens.json`), which is
  gitignored. Back it up privately; never commit it.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `redirect_uri mismatch` | The Redirect URI in the WHOOP app settings must exactly match `WHOOP_REDIRECT_URI`. |
| `Invalid OAuth state` | Service restarted mid-flow — click Connect again. |
| `No WHOOP tokens found` | You haven't connected yet (step 3). |
| `unauthorized` from status/sync | You are calling from outside the server without `X-Sync-Key`. Use the relay route or the header. |
| Token refresh errors | Client ID/secret changed in the WHOOP portal — update `.env` and reconnect. |
