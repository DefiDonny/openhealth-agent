-- Synthetic demo data for OpenHealth Agent.
-- ALL VALUES ARE FAKE. Nothing here comes from a real person or device.
--
-- Usage (after creating the admin account and logging in once):
--   docker compose exec -T database psql -U openhealth -d openhealth < demo/seed-demo-data.sql
--
-- Safe to re-run: inserts are keyed to fixed demo ids and skipped on conflict.

BEGIN;

-- ---------------------------------------------------------------------------
-- WHOOP-like wearable history (30 days: sleep, recovery, strain, workouts)
-- ---------------------------------------------------------------------------
INSERT INTO "HealthData" (id, type, data, "authorId", status, "createdAt", "updatedAt")
SELECT
  'demo_whoop_' || u.id,
  'WHOOP_DATA',
  json_build_object(
    'profile', json_build_object('user_id', 1, 'email', 'demo@example.com',
                                'first_name', 'Demo', 'last_name', 'User'),
    'sleep_history', (SELECT json_agg(json_build_object(
        'date', to_char(current_date - n, 'YYYY-MM-DD'),
        'performance_pct', 78 + (n * 7 % 18),
        'efficiency_pct', 88 + (n * 3 % 9),
        'total_sleep_hrs', 6.2 + ((n * 5 % 16) / 10.0),
        'rem_hrs', 1.2 + ((n * 3 % 8) / 10.0),
        'deep_sleep_hrs', 0.8 + ((n * 2 % 7) / 10.0),
        'resp_rate', 14 + (n % 4),
        'disturbances', n % 5
      ) ORDER BY n) FROM generate_series(0, 29) n),
    'recovery_history', (SELECT json_agg(json_build_object(
        'date', to_char(current_date - n, 'YYYY-MM-DD'),
        'score', 55 + (n * 11 % 40),
        'hrv_ms', 32 + (n * 7 % 30),
        'resting_hr', 56 + (n % 10),
        'skin_temp_c', 33.2 + ((n % 6) / 10.0)
      ) ORDER BY n) FROM generate_series(0, 29) n),
    'daily_strain', (SELECT json_agg(json_build_object(
        'date', to_char(current_date - n, 'YYYY-MM-DD'),
        'strain', 6 + ((n * 3) % 12),
        'avg_hr', 68 + ((n * 5) % 25),
        'max_hr', 128 + ((n * 7) % 40)
      ) ORDER BY n) FROM generate_series(0, 29) n),
    'workouts', (SELECT json_agg(json_build_object(
        'date', to_char(current_date - n * 2, 'YYYY-MM-DD'),
        'sport', CASE n % 3 WHEN 0 THEN 'running' WHEN 1 THEN 'weightlifting' ELSE 'walking' END,
        'strain', 8 + ((n * 5) % 10),
        'avg_hr', 96 + ((n * 9) % 40)
      ) ORDER BY n) FROM generate_series(0, 14) n),
    'synced_at', now()::text,
    'data_note', 'Synthetic demo data - not real measurements.'
  ),
  u.id, 'COMPLETED', now(), now()
FROM "User" u WHERE u.username = 'admin' LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Scale/body-composition history (90 days, pretend smart scale)
-- ---------------------------------------------------------------------------
INSERT INTO "HealthData" (id, type, data, "authorId", status, "createdAt", "updatedAt")
SELECT
  'demo_withings_' || u.id,
  'WITHINGS_DATA',
  json_build_object(
    'source', 'Demo Scale (synthetic)',
    'fileName', 'Body Composition',
    'synced_at', now()::text,
    'measurement_count', 90,
    'measurements', (SELECT json_agg(json_build_object(
        'date', to_char(current_date - n, 'YYYY-MM-DD'),
        'timestamp', extract(epoch FROM (current_date - n))::bigint,
        'weight_kg', round((82.4 - n * 0.03 + ((n * 7 % 9) / 10.0))::numeric, 2),
        'fat_ratio_pct', round((22.5 - n * 0.02 + ((n % 5) / 10.0))::numeric, 2),
        'muscle_mass_kg', round((34.2 + n * 0.01)::numeric, 2),
        'heart_rate_bpm', 62 + (n % 9)
      ) ORDER BY n DESC) FROM generate_series(0, 89) n)
  ),
  u.id, 'COMPLETED', now(), now()
FROM "User" u WHERE u.username = 'admin' LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Manual / imported readings (the record no sync ever touches)
-- ---------------------------------------------------------------------------
INSERT INTO "HealthData" (id, type, data, "authorId", status, "createdAt", "updatedAt")
SELECT
  'demo_manual_' || u.id,
  'MANUAL_READINGS',
  json_build_object(
    'readings', json_build_array(
      json_build_object('timestamp', extract(epoch FROM (current_date - 3))::bigint,
        'date', to_char(current_date - 3, 'YYYY-MM-DD'), 'kind', 'bp',
        'values', json_build_object('systolic', 128, 'diastolic', 82),
        'source', 'manual', 'note', 'Demo reading'),
      json_build_object('timestamp', extract(epoch FROM (current_date - 2))::bigint,
        'date', to_char(current_date - 2, 'YYYY-MM-DD'), 'kind', 'weight',
        'values', json_build_object('weight_kg', 82.1),
        'source', 'manual'),
      json_build_object('timestamp', extract(epoch FROM (current_date - 1))::bigint,
        'date', to_char(current_date - 1, 'YYYY-MM-DD'), 'kind', 'bp',
        'values', json_build_object('systolic', 124, 'diastolic', 79),
        'source', 'csv', 'note', 'Imported from CSV')
    ),
    'count', 3
  ),
  u.id, 'COMPLETED', now(), now()
FROM "User" u WHERE u.username = 'admin' LIMIT 1
ON CONFLICT (id) DO NOTHING;

COMMIT;

SELECT type, jsonb_array_length(
  CASE WHEN type = 'MANUAL_READINGS' THEN data->'readings'
       ELSE data->'measurements' END
) AS demo_rows
FROM "HealthData" WHERE id LIKE 'demo_%' ORDER BY type;
