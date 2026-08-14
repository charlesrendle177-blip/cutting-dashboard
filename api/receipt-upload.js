// Accepts a base64-encoded PDF + metadata, uploads to Supabase Storage,
// then inserts a metadata row into cr_receipts.
// Requires Vercel env var: SUPABASE_SERVICE_ROLE_KEY

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

  const { name, base64, amount, date, category, description } = body;
  if (!name || !base64) return res.status(400).json({ error: 'name and base64 required' });

  const pdfBytes = Buffer.from(base64, 'base64');

  // Basic PDF header check
  if (pdfBytes.slice(0, 4).toString('ascii') !== '%PDF') {
    return res.status(400).json({ error: 'File does not appear to be a PDF' });
  }

  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${Date.now()}_${safeName}`;

  // Upload binary to Supabase Storage
  const uploadRes = await fetch(`${SB_URL}/storage/v1/object/cr-receipts/${storagePath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/pdf',
      'x-upsert': 'false',
    },
    body: pdfBytes,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    return res.status(500).json({ error: `Storage upload failed: ${err}` });
  }

  // Insert metadata row
  const metaRes = await fetch(`${SB_URL}/rest/v1/cr_receipts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      storage_path: storagePath,
      original_name: name,
      amount: amount ? parseFloat(amount) : null,
      date: date || null,
      category: category || 'other',
      description: description || null,
      status: 'unsubmitted',
    }),
  });

  if (!metaRes.ok) {
    const err = await metaRes.text();
    return res.status(500).json({ error: `Metadata insert failed: ${err}` });
  }

  return res.status(200).json({ ok: true, path: storagePath });
};
