// Syncs cr_income and cr_expenses bidirectionally: writes to BOTH cr_shared
// (Clare's read table) and hub_data (Charles's hub table) so either side can
// write and the other sees the update via Supabase realtime.
// REQUIRES Vercel env var: SUPABASE_SERVICE_ROLE_KEY

const SB_URL = 'https://rxwmfssdvpilfvbpbrrq.supabase.co';

async function upsert(table, key, value, serviceKey) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?on_conflict=key`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`${table} write failed: ${await r.text()}`);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { key, value } = body;
  if (!key || !['cr_income', 'cr_expenses'].includes(key)) {
    return res.status(400).json({ error: 'key must be cr_income or cr_expenses' });
  }

  try {
    // Write to both tables in parallel so Charles's realtime fires too
    await Promise.all([
      upsert('cr_shared', key, value, serviceKey),
      upsert('hub_data',  key, value, serviceKey),
    ]);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  return res.status(200).json({ ok: true, key });
};
