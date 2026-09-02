// Renpho automatic sync — pulls latest body measurements and upserts into cutting_logs.
// Uses the current cloud.renpho.com API with AES-128-ECB encrypted payloads.
// REQUIRES Vercel env vars: RENPHO_EMAIL, RENPHO_PASSWORD

const crypto = require('crypto');

const BASE_URL  = 'https://cloud.renpho.com';
const AES_KEY   = 'ed*wijdi$h6fe3ew'; // 16-byte AES-128 key (published in reverse-engineering)
const APP_VER   = '6.6.0';
const PLATFORM  = 'android';

const BODY_WEIGHT_SCALES = [
  '01','02','03','04','05','06','07','08','09','0A',
  '0B','0C','0D','0E','0F','10','11','12','13','14',
];

const SB_URL  = 'https://rxwmfssdvpilfvbpbrrq.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4d21mc3NkdnBpbGZ2YnBicnJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNDY3NjQsImV4cCI6MjA5MTkyMjc2NH0.mG9jnkxhvcXonICd6BAkjCxNDiJJ_xfcJORQIaQuztw';

const SUCCESS_CODES = new Set([0, '0', 101, '101', 200, '200', 20000, '20000']);

// AES-128-ECB helpers
function aesEncrypt(plaintext) {
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(AES_KEY, 'utf8'), null);
  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64');
}

function aesDecrypt(b64) {
  const decipher = crypto.createDecipheriv('aes-128-ecb', Buffer.from(AES_KEY, 'utf8'), null);
  return Buffer.concat([decipher.update(Buffer.from(b64, 'base64')), decipher.final()]).toString('utf8');
}

function encryptReq(obj) {
  return { encryptData: aesEncrypt(JSON.stringify(obj)) };
}

function decryptRes(data) {
  return JSON.parse(aesDecrypt(data));
}

async function renphoPost(endpoint, body, token, userId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.token    = token;
    headers.userId   = String(userId);
    headers.appVersion = APP_VER;
    headers.platform = PLATFORM;
  }
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from /${endpoint}`);
  return res.json();
}

function checkResp(result, ctx) {
  const code = result.code;
  const msg  = (result.msg || '').toLowerCase();
  if (msg === 'success' || SUCCESS_CODES.has(code)) return;
  throw new Error(`${ctx} failed: code=${code} msg=${result.msg}`);
}

async function renphoLogin(email, password) {
  const payload = encryptReq({
    questionnaire: {},
    login: {
      password,
      areaCode: 'US',
      appRevision: APP_VER,
      cellphoneType: 'PythonScript',
      systemType: '11',
      email,
      platform: PLATFORM,
    },
    bindingList: { deviceTypes: BODY_WEIGHT_SCALES },
  });

  const result = await renphoPost('renpho-aggregation/user/login', payload);
  checkResp(result, 'Login');

  const rawJson   = aesDecrypt(result.data);
  const data      = JSON.parse(rawJson);
  const loginInfo = data.login || {};
  const token     = loginInfo.token;

  // Extract userId as raw string to preserve 64-bit precision (JS numbers can't hold it)
  const idMatch = rawJson.match(/"id"\s*:\s*(\d+)/);
  const userId  = idMatch ? idMatch[1] : String(loginInfo.id);

  if (!token) throw new Error('No token in login response: ' + rawJson.slice(0, 200));
  return { token, userId };
}

async function getDeviceInfo(token, userId) {
  const result = await renphoPost('renpho-aggregation/device/count', encryptReq({}), token, userId);
  checkResp(result, 'DeviceInfo');
  return decryptRes(result.data);
}

async function getMeasurements(token, userId, tableName) {
  const all  = [];
  let   page = 1;

  while (true) {
    const payload = encryptReq({
      pageNum:   page,
      pageSize:  50,
      userIds:   [String(userId)],
      tableName,
    });
    const result = await renphoPost('RenphoHealth/scale/queryAllMeasureDataList', payload, token, userId);
    if (!result.data) break;

    const raw  = decryptRes(result.data);
    const rows = Array.isArray(raw) ? raw : (raw.list || raw.data || []);
    if (!rows.length) break;

    all.push(...rows);
    if (rows.length < 50) break;
    page++;
  }

  return all;
}

async function getBodyCompMeasurements(token, userId, tableName) {
  const all  = [];
  let   page = 1;

  while (true) {
    const payload = encryptReq({
      pageNum:   page,
      pageSize:  50,
      userIds:   [String(userId)],
      tableName,
    });
    const result = await renphoPost('RenphoHealth/scale/queryBodyCompositionMeasureData', payload, token, userId);
    if (!result.data) break;

    const raw  = decryptRes(result.data);
    const rows = Array.isArray(raw) ? raw : (raw.list || raw.data || []);
    if (!rows.length) break;

    all.push(...rows);
    if (rows.length < 50) break;
    page++;
  }

  return all;
}

function measurementDate(m) {
  // Different Renpho firmware/table versions use different field names
  const ts = m.time_stamp || m.timeStamp || m.measureTime || m.createTime;
  if (!ts) return null;
  const ms = ts > 1e10 ? ts : ts * 1000; // handle seconds vs milliseconds
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

function interpolateMissing(knownPoints) {
  const sortedDates = Object.keys(knownPoints).sort();
  if (sortedDates.length < 2) return { ...knownPoints };

  const result  = { ...knownPoints };
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
      apikey:           SB_ANON,
      Authorization:    `Bearer ${SB_ANON}`,
      'Content-Type':   'application/json',
      Prefer:           'resolution=merge-duplicates',
    },
    body: JSON.stringify(entries),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase upsert failed (${res.status}): ${err}`);
  }
}

async function syncWithRetry(email, password, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const { token, userId } = await renphoLogin(email, password);
      const deviceData        = await getDeviceInfo(token, userId);
      const scales            = deviceData.scale || [];
      if (!scales.length) return { ok: true, message: 'No scales on account', synced: 0 };

      const tableName = scales[0].tableName;
      let raw = await getBodyCompMeasurements(token, userId, tableName);
      if (!raw.length) raw = await getMeasurements(token, userId, tableName);

      if (!raw.length) {
        return { ok: true, message: 'No measurements found', synced: 0,
          diag: { scaleCount: scales.length, tableName, userId: String(userId) } };
      }

      const knownPoints = {};
      const seenTs      = {};
      for (const m of raw) {
        const iso = measurementDate(m);
        const w   = parseFloat(m.weight);
        if (!iso || isNaN(w)) continue;
        const ts = m.time_stamp || m.timeStamp || m.measureTime || m.createTime || 0;
        if (!seenTs[iso] || ts > seenTs[iso]) {
          knownPoints[iso] = w;
          seenTs[iso]      = ts;
        }
      }

      if (!Object.keys(knownPoints).length) {
        return { ok: true, message: 'No valid weight readings', synced: 0 };
      }

      const filled  = interpolateMissing(knownPoints);
      const entries = Object.entries(filled).map(([date, weight]) => ({ date, weight }));
      await upsertWeights(entries);

      return {
        ok: true,
        synced:       entries.length,
        realReadings: Object.keys(knownPoints).length,
        interpolated: entries.length - Object.keys(knownPoints).length,
      };
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email    = (process.env.RENPHO_EMAIL    || '').trim();
  const password = (process.env.RENPHO_PASSWORD || '').trim();

  if (req.query && req.query.debug === '1') {
    const masked = email.length > 4
      ? email.slice(0, 2) + '***' + email.slice(email.indexOf('@'))
      : '(empty)';
    return res.status(200).json({
      emailSet: !!email, emailMasked: masked, emailLength: email.length,
      passwordSet: !!password, passwordLength: password.length,
    });
  }

  if (!email || !password) {
    return res.status(500).json({ error: 'RENPHO_EMAIL or RENPHO_PASSWORD not set in Vercel env vars' });
  }

  try {
    const result = await syncWithRetry(email, password);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
