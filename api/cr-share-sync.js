// Syncs cr_income and cr_expenses from the main hub into the cr_shared table.
// Uses the Supabase service role key so it can write past RLS.
// REQUIRES Vercel env var: SUPABASE_SERVICE_ROLE_KEY

const SB_URL = 'https://rxwmfssdvpilfvbpbrrq.supabase.co';

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

  const r = await fetch(`${SB_URL}/rest/v1/cr_shared?on_conflict=key`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });

  if (!r.ok) {
    const err = await r.text();
    return res.status(500).json({ error: `Supabase write failed: ${err}` });
  }

  return res.status(200).json({ ok: true, key });
};
