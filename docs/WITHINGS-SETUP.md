# Withings Setup Guide

The Withings integration covers scales and blood-pressure monitors that publish to
the Withings cloud. Like WHOOP, every installation uses **its own Withings
developer app**.

> **Other scales?** Weight readings can also arrive through CSV import or the
> manual-readings API (`POST /api/readings`) — see the README. Withings is simply
> the first supported provider, not a requirement.

## 1. Create your Withings developer app

1. Go to <https://dev.withings.com> and sign in (create a free developer account
   if needed).
2. **Create a new app** — any name and description.
3. **Redirect URI** — must match exactly:
   `https://YOUR-DOMAIN/api/withings/callback`
4. Save. Copy the **Consumer Key** (client ID) and **Consumer Secret**.

Scopes used: `user.info,user.metrics,user.activity` (weight, body composition,
blood pressure, heart rate, activity).

## 2. Configure

Add to `.env` (see `.env.example`):

```bash
PUBLIC_BASE_URL=https://your-domain.example
WITHINGS_CLIENT_ID=your-consumer-key
WITHINGS_CLIENT_SECRET=your-consumer-secret
WITHINGS_REDIRECT_URI=https://your-domain.example/api/withings/callback
SYNC_API_KEY=a-long-random-string
```

Restart the sync service after editing.

## 3. Connect

While logged into the hub, open:

```
https://YOUR-DOMAIN/api/integrations/withings/connect
```

Authorize at Withings; you land on a "Withings Connected" page and the first sync
runs immediately.

Verify from the server:

```bash
curl -s http://localhost:3001/api/withings/status
# {"connected":true,"last_sync":"...","userid":"..."}
```

## What the sync does

- Fetches measurements from the last 6 months on every run.
- **Merges with existing history — readings are permanent.** Nothing is
  overwritten: entries are deduplicated by timestamp and kept newest-first with no
  trimming, so the record only grows.
- Mapped measurements: weight, height, fat-free/fat mass, fat ratio, muscle mass,
  hydration, bone mass, blood pressure (systolic/diastolic), heart rate, pulse
  wave velocity, visceral fat, BMR.
- Withings access tokens expire every ~3 hours; the service refreshes the token on
  every sync run automatically.

## Security notes

- Same policy as WHOOP: `/connect`, `/status`, `/sync` accept localhost or
  `X-Sync-Key`; browsers go through `/api/integrations/withings/*`.
- OAuth callbacks require a matching `state` (CSRF protection).
- Tokens live in `WITHINGS_TOKEN_FILE` (default `./withings_tokens.json`),
  gitignored. Keep it private.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `redirect_uri mismatch` | Redirect URI in the Withings app must exactly match `WITHINGS_REDIRECT_URI`. |
| `Invalid OAuth state` | Service restarted mid-flow — click Connect again. |
| `No Withings tokens` | Not connected yet (step 3). |
| `Withings API error: {"status":...}` | Non-zero status from Withings — status 247/248 usually means invalid token; reconnect. |
| Measurement missing | Consumer products vary by model; unsupported types show as `type_<id>` and are stored unchanged. |
