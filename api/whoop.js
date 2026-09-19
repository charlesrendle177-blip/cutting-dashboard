// WHOOP integration — one function, two jobs, split by whether a `code`
// query param is present (kept as one file to stay under Vercel's Hobby
// plan 12-serverless-function limit):
//
//   ?code=... (WHOOP's OAuth redirect) -> exchange code for tokens, store
//   them in the whoop_tokens table (service-role only, never exposed to
//   the browser's anon key). Visit once to authorize.
//
//   no code -> refresh the stored access token, pull recent sleep, upsert
//   sleep hours into cutting_logs. Only sends { date, sleep } — leaves
//   weight/steps/calories/notes untouched on existing rows.
//
// REQUIRES Vercel env vars: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, SUPABASE_SERVICE_ROLE_KEY

const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API       = 'https://api.prod.whoop.com/developer/v1';
const SB_URL          = 'https://rxwmfssdvpilfvbpbrrq.supabase.co';
const REDIRECT_URI    = 'https://cutting-dashboard.vercel.app/api/whoop-callback';
// Anon key — already public in cutting-logs.js / renpho-sync.js
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4d21mc3NkdnBpbGZ2YnBicnJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNDY3NjQsImV4cCI6MjA5MTkyMjc2NH0.mG9jnkxhvcXonICd6BAkjCxNDiJJ_xfcJORQIaQuztw';

async function getStoredTokens(serviceKey) {
  const r = await fetch(`${SB_URL}/rest/v1/whoop_tokens?id=eq.1&select=*`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!r.ok) throw new Error(`Token lookup failed (${r.status}): ${await r.text()}`);
  const rows = await r.json();
  return rows[0] || null;
}

async function storeTokens(tokens, serviceKey) {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const r = await fetch(`${SB_URL}/rest/v1/whoop_tokens?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      id: 1,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!r.ok) throw new Error(`Token store failed (${r.status}): ${await r.text()}`);
}

async function refreshAccessToken(refreshToken, clientId, clientSecret) {
  const r = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'offline',
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Token refresh failed (${r.status}): ${JSON.stringify(data)}`);
  return data;
}

function tsToIso(ts) {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

async function getRecentSleep(accessToken, daysBack = 14) {
  const start = new Date(Date.now() - daysBack * 86400000).toISOString();
  const url = `${WHOOP_API}/activity/sleep?start=${encodeURIComponent(start)}&limit=25`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await r.json();
  if (!r.ok) throw new Error(`Sleep fetch failed (${r.status}): ${JSON.stringify(data)}`);
  return data.records || [];
}

async function upsertSleep(entries) {
  const r = await fetch(`${SB_URL}/rest/v1/cutting_logs?on_conflict=date`, {
    method: 'POST',
    headers: {
      apikey: SB_ANON,
      Authorization: `Bearer ${SB_ANON}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(entries),
  });
  if (!r.ok) throw new Error(`Supabase upsert failed (${r.status}): ${await r.text()}`);
}

async function handleCallback(req, res, clientId, clientSecret, serviceKey) {
  const { code, error, error_description } = req.query;
  if (error) {
    return res.status(400).send(`WHOOP authorization failed: ${error} — ${error_description || ''}`);
  }

  try {
    const tokenRes = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.status(500).send(`Token exchange failed (${tokenRes.status}): ${JSON.stringify(tokens)}`);
    }

    await storeTokens(tokens, serviceKey);

    return res.status(200).send('WHOOP connected. You can close this tab — daily sync will now run automatically.');
  } catch (e) {
    return res.status(500).send(`Error: ${e.message}`);
  }
}

async function handleSync(req, res, clientId, clientSecret, serviceKey) {
  try {
    const stored = await getStoredTokens(serviceKey);
    if (!stored || !stored.refresh_token) {
      return res.status(400).json({
        error: 'WHOOP not authorized yet. Visit the authorize URL once, then this endpoint will run automatically.',
      });
    }

    const refreshed = await refreshAccessToken(stored.refresh_token, clientId, clientSecret);
    await storeTokens(refreshed, serviceKey);

    const records = await getRecentSleep(refreshed.access_token, 14);

    // Main sleep only (skip naps), keep the latest record per calendar day
    const byDate = {};
    for (const rec of records) {
      if (rec.nap) continue;
      const stages = rec?.score?.stage_summary;
      if (!stages) continue;
      const sleepMs = (stages.total_light_sleep_time_milli || 0)
                    + (stages.total_slow_wave_sleep_time_milli || 0)
                    + (stages.total_rem_sleep_time_milli || 0);
      if (!sleepMs) continue;
      const date = tsToIso(rec.end);
      const hours = Math.round((sleepMs / 3600000) * 10) / 10;
      if (!byDate[date] || new Date(rec.end) > new Date(byDate[date]._end)) {
        byDate[date] = { date, sleep: hours, _end: rec.end };
      }
    }

    const entries = Object.values(byDate).map(({ date, sleep }) => ({ date, sleep }));
    if (entries.length) await upsertSleep(entries);

    return res.status(200).json({ ok: true, synced: entries.length, dates: entries.map(e => e.date) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId     = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'WHOOP_CLIENT_ID or WHOOP_CLIENT_SECRET not set in Vercel env vars' });
  }
  if (!serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set in Vercel env vars' });
  }

  if (req.query.code || req.query.error) {
    return handleCallback(req, res, clientId, clientSecret, serviceKey);
  }
  return handleSync(req, res, clientId, clientSecret, serviceKey);
};
