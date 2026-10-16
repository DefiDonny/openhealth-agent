# Demo data

Fully synthetic data (wearable history, scale readings, manual readings) so the
dashboard, sparklines and AI chat can be explored without connecting any real
device or account. **All values are fake — nothing here comes from a real person.**

## Seed

Create the admin account and log in once first (the seed attaches to the
`admin` user), then run:

```bash
docker compose exec -T database psql -U openhealth -d openhealth < demo/seed-demo-data.sql
```

Re-running is safe: rows use fixed `demo_*` ids and are skipped if present.

## What you get

| Record | Contents |
|---|---|
| `WHOOP_DATA` | 30 days of sleep, recovery, strain and workouts |
| `WITHINGS_DATA` | 90 days of weight/body-composition readings |
| `MANUAL_READINGS` | blood pressure + weight entries (`manual` / `csv` sources) |

## Clean up

```bash
docker compose exec -T database psql -U openhealth -d openhealth \
  -c "DELETE FROM \"HealthData\" WHERE id LIKE 'demo_%';"
```
