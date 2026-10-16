const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

// Config
const WHOOP_CLIENT_ID = process.env.WHOOP_CLIENT_ID;
const WHOOP_CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET;
const WHOOP_REDIRECT_URI = process.env.WHOOP_REDIRECT_URI;
const WHOOP_API_BASE = 'https://api.prod.whoop.com';
const TOKEN_FILE = process.env.TOKEN_FILE || './tokens.json';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;
const REQUIRED_ENV = ['WHOOP_CLIENT_ID','WHOOP_CLIENT_SECRET','WHOOP_REDIRECT_URI','PUBLIC_BASE_URL','POSTGRES_USER','POSTGRES_PASSWORD','POSTGRES_DB'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length) {
  console.error('Missing required environment variables: ' + missingEnv.join(', '));
  process.exit(1);
}

// OAuth state storage
let pendingOAuthState = null;

// Database connection to OpenHealth's PostgreSQL
const pool = new Pool({
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  host: 'localhost',
  port: 5432,
  database: process.env.POSTGRES_DB
});

// Token storage
function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading tokens:', e.message);
  }
  return null;
}

async function refreshAccessToken(tokens) {
  const response = await fetch(`${WHOOP_API_BASE}/oauth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: WHOOP_CLIENT_ID,
      client_secret: WHOOP_CLIENT_SECRET,
    })
  });
  const data = await response.json();
  if (data.access_token) {
    const newTokens = { ...tokens, ...data, updated_at: new Date().toISOString() };
    saveTokens(newTokens);
    return newTokens;
  }
  throw new Error('Token refresh failed: ' + JSON.stringify(data));
}

async function whoopGet(endpoint, tokens) {
  let currentTokens = tokens;
  let response = await fetch(`${WHOOP_API_BASE}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${currentTokens.access_token}` }
  });
  
  if (response.status === 401) {
    currentTokens = await refreshAccessToken(currentTokens);
    response = await fetch(`${WHOOP_API_BASE}${endpoint}`, {
      headers: { 'Authorization': `Bearer ${currentTokens.access_token}` }
    });
  }
  
  return { data: await response.json(), tokens: currentTokens };
}

// OAuth initiate — with required state parameter
app.get('/api/whoop/connect', (req, res) => {
  const scopes = 'offline read:recovery read:cycles read:workout read:sleep read:profile read:body_measurement';
  pendingOAuthState = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: WHOOP_CLIENT_ID,
    redirect_uri: WHOOP_REDIRECT_URI,
    response_type: 'code',
    scope: scopes,
    state: pendingOAuthState
  });
  const authUrl = `${WHOOP_API_BASE}/oauth/oauth2/auth?${params.toString()}`;
  res.redirect(authUrl);
});

// OAuth callback
app.get('/api/whoop/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  
  if (error) {
    return res.status(400).send(`
      <html>
      <head><title>WHOOP Connection Error</title></head>
      <body style="background:#0a0e17;color:#e8edf5;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center">
        <div>
          <h1 style="color:#ef4444">WHOOP Connection Failed</h1>
          <p style="color:#94a3b8">${error}: ${error_description || 'Unknown error'}</p>
          <a href="${PUBLIC_BASE_URL}/api/whoop/connect" style="color:#06b6d4;margin-top:20px;display:inline-block">Try Again</a>
        </div>
      </body>
      </html>
    `);
  }
  
  if (!code) return res.status(400).send('Missing authorization code');
  
  if (pendingOAuthState && state !== pendingOAuthState) {
    return res.status(400).send('Invalid OAuth state - possible CSRF attack');
  }
  pendingOAuthState = null;

  try {
    const response = await fetch(`${WHOOP_API_BASE}/oauth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: WHOOP_REDIRECT_URI,
        client_id: WHOOP_CLIENT_ID,
        client_secret: WHOOP_CLIENT_SECRET,
      })
    });

    const tokens = await response.json();
    console.log('[OAUTH] Token response keys:', Object.keys(tokens));
    console.log('[OAUTH] Has refresh_token:', !!tokens.refresh_token);
    if (tokens.access_token) {
      tokens.created_at = new Date().toISOString();
      saveTokens(tokens);
      
      // Trigger initial sync
      syncWhoopData().catch(console.error);
      
      res.send(`
        <html>
        <head><title>WHOOP Connected</title></head>
        <body style="background:#0a0e17;color:#e8edf5;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center">
          <div>
            <h1 style="color:#06b6d4">WHOOP Connected Successfully</h1>
            <p style="color:#94a3b8">Your wearable data will now sync automatically.</p>
            <a href="${PUBLIC_BASE_URL}" style="color:#06b6d4;margin-top:20px;display:inline-block">Return to AI Health Hub</a>
          </div>
        </body>
        </html>
      `);
    } else {
      res.status(400).send('OAuth error: ' + JSON.stringify(tokens));
    }
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('OAuth error: ' + err.message);
  }
});

// Status endpoint
app.get('/api/whoop/status', (req, res) => {
  const tokens = loadTokens();
  res.json({
    connected: !!tokens,
    last_sync: tokens?.last_sync || null,
    token_updated: tokens?.updated_at || tokens?.created_at || null
  });
});

// Manual sync trigger
app.post('/api/whoop/sync', async (req, res) => {
  try {
    const result = await syncWhoopData();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Main sync function
async function syncWhoopData() {
  let tokens = loadTokens();
  if (!tokens) throw new Error('No WHOOP tokens found. Connect WHOOP first.');

  console.log(`[${new Date().toISOString()}] Starting WHOOP sync...`);

  // Calculate date range: fetch last 4 months by default, or 7 days for daily sync
  const isFullSync = !tokens.last_sync; // First sync = full 4 months
  const startDate = new Date();
  if (isFullSync) {
    startDate.setMonth(startDate.getMonth() - 4);
  } else {
    startDate.setDate(startDate.getDate() - 7);
  }
  const startParam = `&start=${startDate.toISOString()}`;
  const limit = isFullSync ? 25 : 10;
  console.log(`Sync mode: ${isFullSync ? 'FULL (4 months)' : 'DAILY (7 days)'}`);

  // Helper to paginate through all results
  async function fetchAllPages(endpoint, currentTokens) {
    let allRecords = [];
    let nextToken = null;
    let page = 0;
    do {
      const tokenParam = nextToken ? `&nextToken=${nextToken}` : '';
      const separator = endpoint.includes('?') ? '&' : '?';
      const url = `${endpoint}${separator}limit=${limit}${startParam}${tokenParam}`;
      const result = await whoopGet(url, currentTokens);
      currentTokens = result.tokens;
      if (result.data.records) allRecords = allRecords.concat(result.data.records);
      nextToken = result.data.next_token || null;
      page++;
    } while (nextToken && page < 20); // Safety limit
    return { records: allRecords, tokens: currentTokens };
  }

  // Fetch profile (v2 API)
  const profileResult = await whoopGet('/developer/v2/user/profile/basic', tokens);
  tokens = profileResult.tokens;
  const profile = profileResult.data;

  // NOTE: Skipping body measurements — weight data is unreliable/stale in WHOOP

  // Fetch recovery with pagination (v2 API)
  const recoveryResult = await fetchAllPages('/developer/v2/recovery', tokens);
  tokens = recoveryResult.tokens;

  // Fetch sleep with pagination (v2 API)
  const sleepResult = await fetchAllPages('/developer/v2/activity/sleep', tokens);
  tokens = sleepResult.tokens;

  // Fetch cycles with pagination (v2 API)
  const cyclesResult = await fetchAllPages('/developer/v2/cycle', tokens);
  tokens = cyclesResult.tokens;

  // Fetch workouts with pagination (v2 API)
  const workoutsResult = await fetchAllPages('/developer/v2/activity/workout', tokens);
  tokens = workoutsResult.tokens;

  // Filter out SpO2 from recovery scores (unreliable on WHOOP)
  for (const record of recoveryResult.records) {
    if (record.score && record.score.spo2_percentage !== undefined) {
      delete record.score.spo2_percentage;
    }
  }

  // Get the admin user ID from OpenHealth DB
  const userResult = await pool.query("SELECT id FROM \"User\" WHERE username = 'admin' LIMIT 1");
  if (userResult.rows.length === 0) throw new Error('Admin user not found in database');
  const userId = userResult.rows[0].id;

  // Upsert WHOOP data as HealthData entries (NO body/weight, NO SpO2)
  const whoopData = {
    profile: profile,
    recovery: { records: recoveryResult.records },
    sleep: { records: sleepResult.records },
    cycles: { records: cyclesResult.records },
    workouts: { records: workoutsResult.records },
    synced_at: new Date().toISOString(),
    sync_mode: isFullSync ? 'full_4_months' : 'daily',
    total_records: recoveryResult.records.length + sleepResult.records.length + cyclesResult.records.length + workoutsResult.records.length
  };

  // Compact the data to reduce token usage
  // Remove raw record details, keep only key metrics per day
  if (whoopData.recovery && whoopData.recovery.records) {
    whoopData.recovery_history = whoopData.recovery.records.map(r => ({
      date: (r.created_at || '').substring(0, 10),
      score: r.score?.recovery_score,
      hrv_ms: Math.round((r.score?.hrv_rmssd_milli || 0) * 10) / 10,
      resting_hr: r.score?.resting_heart_rate,
      skin_temp_c: Math.round((r.score?.skin_temp_celsius || 0) * 10) / 10,
    }));
    delete whoopData.recovery;
  }
  if (whoopData.sleep && whoopData.sleep.records) {
    whoopData.sleep_history = whoopData.sleep.records.map(s => {
      const sc = s.score || {};
      const st = sc.stage_summary || {};
      const totalMs = (st.total_in_bed_time_milli || 0) - (st.total_awake_time_milli || 0);
      return {
        date: (s.start || '').substring(0, 10),
        performance_pct: sc.sleep_performance_percentage,
        efficiency_pct: Math.round((sc.sleep_efficiency_percentage || 0) * 10) / 10,
        total_sleep_hrs: Math.round(totalMs / 3600000 * 10) / 10,
        rem_hrs: Math.round((st.total_rem_sleep_time_milli || 0) / 3600000 * 10) / 10,
        deep_sleep_hrs: Math.round((st.total_slow_wave_sleep_time_milli || 0) / 3600000 * 10) / 10,
        resp_rate: Math.round((sc.respiratory_rate || 0) * 10) / 10,
        disturbances: st.disturbance_count,
      };
    });
    delete whoopData.sleep;
  }
  if (whoopData.cycles && whoopData.cycles.records) {
    whoopData.daily_strain = whoopData.cycles.records.map(c => ({
      date: (c.start || '').substring(0, 10),
      strain: Math.round((c.score?.strain || 0) * 10) / 10,
      avg_hr: c.score?.average_heart_rate,
      max_hr: c.score?.max_heart_rate,
    }));
    delete whoopData.cycles;
  }
  if (whoopData.workouts && whoopData.workouts.records) {
    whoopData.workouts = whoopData.workouts.records.map(w => ({
      date: (w.start || '').substring(0, 10),
      sport: w.sport_name || 'unknown',
      strain: Math.round((w.score?.strain || 0) * 10) / 10,
      avg_hr: w.score?.average_heart_rate,
    }));
  }
  whoopData.data_note = 'SpO2 and weight excluded (unreliable from WHOOP). Data compacted for token efficiency.';

  // Check if WHOOP health data exists
  const existing = await pool.query(
    "SELECT id FROM \"HealthData\" WHERE \"authorId\" = $1 AND type = 'WHOOP_DATA'",
    [userId]
  );

  if (existing.rows.length > 0) {
    // MERGE with existing data to accumulate history
    const existingResult = await pool.query("SELECT data::text FROM \"HealthData\" WHERE id = $1", [existing.rows[0].id]);
    const existingData = JSON.parse(existingResult.rows[0].data || '{}');
    
    // Merge each history array: combine, deduplicate by date, sort desc, keep last 120 days
    const mergeArrays = (existing, incoming, dateKey) => {
      const combined = [...(incoming || []), ...(existing || [])];
      const seen = new Set();
      return combined.filter(item => {
        const key = item[dateKey || 'date'];
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((a, b) => (b[dateKey || 'date'] || '').localeCompare(a[dateKey || 'date'] || '')).slice(0, 120);
    };
    
    whoopData.sleep_history = mergeArrays(existingData.sleep_history, whoopData.sleep_history, 'date');
    whoopData.recovery_history = mergeArrays(existingData.recovery_history, whoopData.recovery_history, 'date');
    whoopData.daily_strain = mergeArrays(existingData.daily_strain, whoopData.daily_strain, 'date');
    whoopData.workouts = mergeArrays(existingData.workouts, whoopData.workouts, 'date');
    whoopData.total_records = (whoopData.sleep_history?.length || 0) + (whoopData.recovery_history?.length || 0) + (whoopData.daily_strain?.length || 0) + (whoopData.workouts?.length || 0);
    
    await pool.query(
      "UPDATE \"HealthData\" SET data = $1, \"updatedAt\" = NOW() WHERE id = $2",
      [JSON.stringify(whoopData), existing.rows[0].id]
    );
    console.log('Updated existing WHOOP data record');
  } else {
    const cuid = 'whoop_' + Date.now().toString(36);
    await pool.query(
      `INSERT INTO "HealthData" (id, type, data, "authorId", status, "createdAt", "updatedAt") 
       VALUES ($1, 'WHOOP_DATA', $2, $3, 'COMPLETED', NOW(), NOW())`,
      [cuid, JSON.stringify(whoopData), userId]
    );
    console.log('Created new WHOOP data record');
  }

  // Update token with last sync time
  tokens.last_sync = new Date().toISOString();
  saveTokens(tokens);

  console.log(`[${new Date().toISOString()}] WHOOP sync complete`);
  return { 
    synced_at: tokens.last_sync,
    records: {
      recovery: recoveryResult.data?.records?.length || 0,
      sleep: sleepResult.data?.records?.length || 0,
      cycles: cyclesResult.data?.records?.length || 0,
      workouts: workoutsResult.data?.records?.length || 0
    }
  };
}

// Withings integration
const { setupWithingsRoutes, syncWithingsData: syncWithings } = require("./withings-service");
setupWithingsRoutes(app, pool);

// Start server
app.listen(PORT, '127.0.0.1', () => {
  console.log(`WHOOP sync service running on port ${PORT}`);
});

module.exports = { syncWhoopData };
