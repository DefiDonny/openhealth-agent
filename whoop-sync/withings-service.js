// Withings integration - add to the existing WHOOP sync service
// This adds /api/withings/* endpoints alongside the /api/whoop/* endpoints

const crypto = require('crypto');

// Withings Config
const WITHINGS_CLIENT_ID = process.env.WITHINGS_CLIENT_ID;
const WITHINGS_CLIENT_SECRET = process.env.WITHINGS_CLIENT_SECRET;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;
const WITHINGS_REDIRECT_URI = process.env.WITHINGS_REDIRECT_URI;
const WITHINGS_TOKEN_FILE = process.env.WITHINGS_TOKEN_FILE || './withings_tokens.json';

// Withings measurement type IDs
const MEASURE_TYPES = {
  1: 'weight_kg',
  4: 'height_m',
  5: 'fat_free_mass_kg',
  6: 'fat_ratio_pct',
  8: 'fat_mass_kg',
  9: 'diastolic_bp',
  10: 'systolic_bp',
  11: 'heart_rate_bpm',
  76: 'muscle_mass_kg',
  77: 'hydration_kg',
  88: 'bone_mass_kg',
  91: 'pulse_wave_velocity',
  170: 'visceral_fat_index',
  226: 'bmr_kcal',
};

let pendingWithingsState = null;

function saveWithingsTokens(tokens) {
  const fs = require('fs');
  fs.writeFileSync(WITHINGS_TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

function loadWithingsTokens() {
  const fs = require('fs');
  try {
    if (fs.existsSync(WITHINGS_TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(WITHINGS_TOKEN_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading Withings tokens:', e.message);
  }
  return null;
}

async function refreshWithingsToken(tokens) {
  const fetch = require('node-fetch');
  const params = new URLSearchParams({
    action: 'requesttoken',
    grant_type: 'refresh_token',
    client_id: WITHINGS_CLIENT_ID,
    client_secret: WITHINGS_CLIENT_SECRET,
    refresh_token: tokens.refresh_token,
  });
  const response = await fetch('https://wbsapi.withings.net/v2/oauth2', {
    method: 'POST',
    body: params,
  });
  const data = await response.json();
  if (data.status === 0 && data.body.access_token) {
    const newTokens = {
      access_token: data.body.access_token,
      refresh_token: data.body.refresh_token,
      expires_in: data.body.expires_in,
      userid: data.body.userid,
      updated_at: new Date().toISOString(),
    };
    saveWithingsTokens(newTokens);
    return newTokens;
  }
  throw new Error('Withings token refresh failed: ' + JSON.stringify(data));
}

function setupWithingsRoutes(app, pool, requireSyncAuth) {
  // OAuth initiate
  app.get('/api/withings/connect', requireSyncAuth, (req, res) => {
    pendingWithingsState = crypto.randomBytes(16).toString('hex');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: WITHINGS_CLIENT_ID,
      redirect_uri: WITHINGS_REDIRECT_URI,
      scope: 'user.info,user.metrics,user.activity',
      state: pendingWithingsState,
    });
    res.redirect(`https://account.withings.com/oauth2_user/authorize2?${params.toString()}`);
  });

  // OAuth callback
  app.get('/api/withings/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.status(400).send(`Withings error: ${error}`);
    if (!code) return res.status(400).send('Missing authorization code');
    if (!state || state !== pendingWithingsState) {
      return res.status(400).send('Invalid OAuth state - possible CSRF. Go back and click Connect again.');
    }
    pendingWithingsState = null;

    try {
      const fetch = require('node-fetch');
      const params = new URLSearchParams({
        action: 'requesttoken',
        grant_type: 'authorization_code',
        client_id: WITHINGS_CLIENT_ID,
        client_secret: WITHINGS_CLIENT_SECRET,
        code: code,
        redirect_uri: WITHINGS_REDIRECT_URI,
      });
      const response = await fetch('https://wbsapi.withings.net/v2/oauth2', {
        method: 'POST',
        body: params,
      });
      const data = await response.json();
      console.log('[WITHINGS] Token response status:', data.status);

      if (data.status === 0 && data.body.access_token) {
        const tokens = {
          access_token: data.body.access_token,
          refresh_token: data.body.refresh_token,
          expires_in: data.body.expires_in,
          userid: data.body.userid,
          created_at: new Date().toISOString(),
        };
        saveWithingsTokens(tokens);

        // Trigger initial sync
        syncWithingsData(pool).catch(console.error);

        res.send(`
          <html><body style="background:#0a0e17;color:#e8edf5;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center">
          <div><h1 style="color:#06b6d4">Withings Connected</h1>
          <p style="color:#94a3b8">Your scale data will now sync automatically.</p>
          <a href="${PUBLIC_BASE_URL}" style="color:#06b6d4;margin-top:20px;display:inline-block">Return to Health Hub</a></div></body></html>
        `);
      } else {
        res.status(400).send('Withings OAuth error: ' + JSON.stringify(data));
      }
    } catch (err) {
      console.error('Withings callback error:', err);
      res.status(500).send('Error: ' + err.message);
    }
  });

  // Status
  app.get('/api/withings/status', requireSyncAuth, (req, res) => {
    const tokens = loadWithingsTokens();
    res.json({
      connected: !!tokens,
      last_sync: tokens?.last_sync || null,
      userid: tokens?.userid || null,
    });
  });

  // Manual sync
  app.post('/api/withings/sync', requireSyncAuth, async (req, res) => {
    try {
      const result = await syncWithingsData(pool);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

async function syncWithingsData(pool) {
  let tokens = loadWithingsTokens();
  if (!tokens) throw new Error('No Withings tokens. Connect first.');

  const fetch = require('node-fetch');
  console.log(`[${new Date().toISOString()}] Starting Withings sync...`);

  // Refresh token if needed (Withings tokens last 3 hours)
  try {
    tokens = await refreshWithingsToken(tokens);
  } catch (e) {
    console.log('[WITHINGS] Token refresh failed, using existing:', e.message);
  }

  // Fetch measurements (last 6 months)
  const sixMonthsAgo = Math.floor(Date.now() / 1000) - (180 * 86400);
  const now = Math.floor(Date.now() / 1000);

  const measureParams = new URLSearchParams({
    action: 'getmeas',
    startdate: sixMonthsAgo.toString(),
    enddate: now.toString(),
    category: '1', // Real measurements only (not user objectives)
  });

  const measureResponse = await fetch('https://wbsapi.withings.net/measure', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: measureParams,
  });
  const measureData = await measureResponse.json();

  if (measureData.status !== 0) {
    throw new Error('Withings API error: ' + JSON.stringify(measureData));
  }

  // Parse measurements into readable format
  const measurements = [];
  for (const grp of (measureData.body?.measuregrps || [])) {
    const date = new Date(grp.date * 1000).toISOString().split('T')[0];
    const entry = { date, timestamp: grp.date };

    for (const m of grp.measures) {
      const realValue = m.value * Math.pow(10, m.unit);
      const name = MEASURE_TYPES[m.type] || `type_${m.type}`;
      entry[name] = Math.round(realValue * 100) / 100;
    }
    measurements.push(entry);
  }

  // Sort by date descending
  measurements.sort((a, b) => b.timestamp - a.timestamp);

  // Get admin user ID
  const userResult = await pool.query("SELECT id FROM \"User\" WHERE username = 'admin' LIMIT 1");
  if (userResult.rows.length === 0) throw new Error('Admin user not found');
  const userId = userResult.rows[0].id;

  // Find existing record
  const existing = await pool.query(
    "SELECT id FROM \"HealthData\" WHERE \"authorId\" = $1 AND type = 'WITHINGS_DATA'",
    [userId]
  );

  // MERGE with existing readings — never overwrite; history is permanent.
  // Dedupe by signature (timestamp + values): a re-fetch of the same data adds
  // nothing, while distinct readings that share a timestamp are all kept.
  const signature = (item) => Object.keys(item).sort().map((k) => `${k}=${item[k]}`).join('|');
  let merged = measurements;
  if (existing.rows.length > 0) {
    const existingResult = await pool.query("SELECT data::text FROM \"HealthData\" WHERE id = $1", [existing.rows[0].id]);
    const existingData = JSON.parse(existingResult.rows[0].data || '{}');
    const combined = [...measurements, ...(existingData.measurements || [])];
    const seen = new Set();
    merged = combined.filter(item => {
      const key = signature(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (merged.length < measurements.length) {
      throw new Error(`merge produced fewer readings (${merged.length}) than incoming (${measurements.length}) - refusing to write`);
    }
    console.log(`Withings merge: ${measurements.length} incoming + ${merged.length - measurements.length} kept = ${merged.length} total`);
  }

  const withingsData = {
    source: 'Withings Smart Scale',
    fileName: 'Withings Body Composition',
    synced_at: new Date().toISOString(),
    measurement_count: merged.length,
    measurements: merged,
  };

  if (existing.rows.length > 0) {
    await pool.query(
      "UPDATE \"HealthData\" SET data = $1, \"updatedAt\" = NOW() WHERE id = $2",
      [JSON.stringify(withingsData), existing.rows[0].id]
    );
    console.log('Updated Withings data (merged, no readings lost)');
  } else {
    const cuid = 'withings_' + Date.now().toString(36);
    await pool.query(
      `INSERT INTO "HealthData" (id, type, data, "authorId", status, "createdAt", "updatedAt")
       VALUES ($1, 'WITHINGS_DATA', $2, $3, 'COMPLETED', NOW(), NOW())`,
      [cuid, JSON.stringify(withingsData), userId]
    );
    console.log('Created Withings data record');
  }

  tokens.last_sync = new Date().toISOString();
  saveWithingsTokens(tokens);

  console.log(`[${new Date().toISOString()}] Withings sync complete: ${measurements.length} measurements`);
  return {
    synced_at: tokens.last_sync,
    new_measurements: measurements.length,
    total_measurements: merged.length,
    latest: merged[0] || null,
  };
}

module.exports = { setupWithingsRoutes, syncWithingsData };
