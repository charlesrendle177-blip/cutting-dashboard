// Renpho automatic sync — pulls latest body measurements and upserts into cutting_logs.
// Missing days between real measurements are filled with linear interpolation.
// REQUIRES Vercel env vars: RENPHO_EMAIL, RENPHO_PASSWORD

const crypto = require('crypto');

const RENPHO_SERVERS = [
  'https://renpho.qnclouds.com',
  'https://uk.renpho.qnclouds.com',
  'https://eu.renpho.qnclouds.com',
];
const SB_URL  = 'https://rxwmfssdvpilfvbpbrrq.supabase.co';
// Anon key — already public in cutting-logs.js, safe to include here
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4d21mc3NkdnBpbGZ2YnBicnJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNDY3NjQsImV4cCI6MjA5MTkyMjc2NH0.mG9jnkxhvcXonICd6BAkjCxNDiJJ_xfcJORQIaQuztw';

const RENPHO_ATTEMPTS = [
  { secure_flag: 1, hash: 'md5' },
  { secure_flag: 1, hash: 'sha256' },
  { secure_flag: 0, hash: 'md5' },
];

async function renphoLogin(email, password) {
  const base = RENPHO_SERVERS[0];
  const errors = [];
  for (const attempt of RENPHO_ATTEMPTS) {
    const password_hash = crypto.createHash(attempt.hash).update(password).digest('hex');
    const body = { email, password_hash };
    if (attempt.secure_flag) body.secure_flag = attempt.secure_flag;
    try {
      const res = await fetch(`${base}/api/v3/users/sign_in.json?app_id=Renpho`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const key = data.terminal_user_session_key;
      if (key) return { key, base, attempt };
      errors.push(`[${attempt.hash}+secure_flag=${attempt.secure_flag}] ${JSON.stringify(data)}`);
    } catch (e) {
      errors.push(`[${attempt.hash}+secure_flag=${attempt.secure_flag}] ${e.message}`);
    }
  }
  throw new Error('All auth attempts failed:\n' + errors.join('\n'));
}

async function getScaleUserId(base, sessionKey) {
  const res = await fetch(
    `${base}/api/v3/scale_users/list_scale_user?locale=en&terminal_user_session_key=${sessionKey}`
  );
  const data = await res.json();
  const users = data.scale_users || [];
  if (!users.length) throw new Error('No scale users found on this Renpho account');
  return users[0].user_id;
}

async function getMeasurements(base, sessionKey, userId, daysBack = 60) {
  const lastAt = Math.floor(Date.now() / 1000) - daysBack * 86400;
  const res = await fetch(
    `${base}/api/v2/measurements/list.json?user_id=${userId}&last_at=${lastAt}&locale=en&app_id=Renpho&terminal_user_session_key=${sessionKey}`
  );
  const data = await res.json();
  return data.last_ary || [];
}

function tsToIso(ts) {
  return new Date(ts * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

function interpolateMissing(knownPoints) {
  const sortedDates = Object.keys(knownPoints).sort();
  if (sortedDates.length < 2) return { ...knownPoints };

  const result = { ...knownPoints };
  const startMs = Date.parse(sortedDates[0]);
  const endMs   = Date.parse(sortedDates[sortedDates.length - 1]);

  for (let ms = startMs; ms <= endMs; ms += 86400000) {
    const iso = new Date(ms).toISOString().slice(0, 10);
    if (result[iso] !== undefined) continue;

    const prev = sortedDates.filter(k => k < iso).at(-1);
    const next = sortedDates.find(k => k > iso);
    if (!prev || !next) continue;

    const span   = (Date.parse(next) - Date.parse(prev)) / 86400000;
    const offset = (ms - Date.parse(prev)) / 86400000;
    const interp = knownPoints[prev] + (knownPoints[next] - knownPoints[prev]) * (offset / span);
    result[iso]  = Math.round(interp * 100) / 100;
  }
  return result;
}

async function upsertWeights(entries) {
  const res = await fetch(`${SB_URL}/rest/v1/cutting_logs?on_conflict=date`, {
    method: 'POST',
    headers: {
      apikey: SB_ANON,
      Authorization: `Bearer ${SB_ANON}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(entries),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase upsert failed (${res.status}): ${err}`);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email    = (process.env.RENPHO_EMAIL || '').trim();
  const password = (process.env.RENPHO_PASSWORD || '').trim();

  if (req.query && req.query.debug === '1') {
    const masked = email.length > 4
      ? email.slice(0, 2) + '***' + email.slice(email.indexOf('@'))
      : '(empty)';
    return res.status(200).json({
      emailSet: !!email,
      emailMasked: masked,
      emailLength: email.length,
      passwordSet: !!password,
      passwordLength: password.length,
    });
  }

  if (!email || !password) {
    return res.status(500).json({ error: 'RENPHO_EMAIL or RENPHO_PASSWORD not set in Vercel env vars' });
  }

  try {
    const { key: sessionKey, base } = await renphoLogin(email, password);
    const userId = await getScaleUserId(base, sessionKey);
    const raw    = await getMeasurements(base, sessionKey, userId, 60);

    if (!raw.length) {
      return res.status(200).json({ ok: true, message: 'No measurements in last 60 days', synced: 0 });
    }

    const knownPoints = {};
    const seenTs      = {};
    for (const m of raw) {
      const iso = tsToIso(m.time_stamp);
      const w   = parseFloat(m.weight);
      if (!seenTs[iso] || m.time_stamp > seenTs[iso]) {
        knownPoints[iso] = w;
        seenTs[iso]      = m.time_stamp;
      }
    }

    const filled  = interpolateMissing(knownPoints);
    const entries = Object.entries(filled).map(([date, weight]) => ({ date, weight }));

    await upsertWeights(entries);

    return res.status(200).json({
      ok: true,
      server: base,
      synced: entries.length,
      realReadings: Object.keys(knownPoints).length,
      interpolated: entries.length - Object.keys(knownPoints).length,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
