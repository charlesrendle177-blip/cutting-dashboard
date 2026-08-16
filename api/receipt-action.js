// Handles receipt vault actions: list, url (signed download), update status, delete.
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

  const { action } = body;
  const headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };

  // ── list ──────────────────────────────────────────────────────────────────
  if (action === 'list') {
    const r = await fetch(`${SB_URL}/rest/v1/cr_receipts?order=created_at.desc`, { headers });
    if (!r.ok) return res.status(500).json({ error: 'List failed' });
    const receipts = await r.json();
    return res.status(200).json({ receipts });
  }

  // ── url (signed download link, 1 hour) ───────────────────────────────────
  if (action === 'url') {
    const { path } = body;
    if (!path) return res.status(400).json({ error: 'path required' });
    const r = await fetch(`${SB_URL}/storage/v1/object/sign/cr-receipts/${path}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!r.ok) return res.status(500).json({ error: 'Signed URL failed' });
    const data = await r.json();
    const raw = data.signedURL || data.signedUrl || null;
    const url = raw ? (raw.startsWith('http') ? raw : `${SB_URL}${raw}`) : null;
    return res.status(200).json({ url });
  }

  // ── replace-file (swap the PDF, keep the row) ────────────────────────────
  if (action === 'replace-file') {
    const { id, old_path, name, base64 } = body;
    if (!id || !name || !base64) return res.status(400).json({ error: 'id, name, and base64 required' });

    const pdfBytes = Buffer.from(base64, 'base64');
    if (pdfBytes.slice(0, 4).toString('ascii') !== '%PDF') {
      return res.status(400).json({ error: 'File does not appear to be a PDF' });
    }

    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const newPath  = `${Date.now()}_${safeName}`;

    const uploadRes = await fetch(`${SB_URL}/storage/v1/object/cr-receipts/${newPath}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/pdf', 'x-upsert': 'false' },
      body: pdfBytes,
    });
    if (!uploadRes.ok) return res.status(500).json({ error: 'Storage upload failed' });

    const updateRes = await fetch(`${SB_URL}/rest/v1/cr_receipts?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage_path: newPath, original_name: name }),
    });
    if (!updateRes.ok) {
      await fetch(`${SB_URL}/storage/v1/object/cr-receipts/${newPath}`, { method: 'DELETE', headers }).catch(() => {});
      return res.status(500).json({ error: 'Row update failed' });
    }

    if (old_path) {
      await fetch(`${SB_URL}/storage/v1/object/cr-receipts/${old_path}`, { method: 'DELETE', headers }).catch(() => {});
    }

    return res.status(200).json({ ok: true, path: newPath });
  }

  // ── update (status toggle OR metadata edit) ───────────────────────────────
  if (action === 'update') {
    const { id, status, amount, date, category, description } = body;
    if (!id) return res.status(400).json({ error: 'id required' });

    const patch = {};
    if (status !== undefined) {
      if (!['submitted', 'unsubmitted'].includes(status)) {
        return res.status(400).json({ error: 'status must be submitted or unsubmitted' });
      }
      patch.status = status;
    }
    if (amount      !== undefined) patch.amount      = amount;
    if (date        !== undefined) patch.date        = date || null;
    if (category    !== undefined) patch.category    = category;
    if (description !== undefined) patch.description = description || null;

    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });

    const r = await fetch(`${SB_URL}/rest/v1/cr_receipts?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) return res.status(500).json({ error: 'Update failed' });
    return res.status(200).json({ ok: true });
  }

  // ── delete ────────────────────────────────────────────────────────────────
  if (action === 'delete') {
    const { id, path } = body;
    if (!id) return res.status(400).json({ error: 'id required' });

    // Remove file from storage (best-effort — don't fail if already gone)
    if (path) {
      await fetch(`${SB_URL}/storage/v1/object/cr-receipts/${path}`, {
        method: 'DELETE',
        headers,
      }).catch(() => {});
    }

    const r = await fetch(`${SB_URL}/rest/v1/cr_receipts?id=eq.${id}`, {
      method: 'DELETE',
      headers,
    });
    if (!r.ok) return res.status(500).json({ error: 'Delete failed' });
    return res.status(200).json({ ok: true });
  }

  // ── duplicate (copy row with date +1 month, same file) ───────────────────
  if (action === 'duplicate') {
    const { id } = body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const gr = await fetch(`${SB_URL}/rest/v1/cr_receipts?id=eq.${id}&select=*`, { headers });
    if (!gr.ok) return res.status(500).json({ error: 'Fetch failed' });
    const rows = await gr.json();
    if (!rows.length) return res.status(404).json({ error: 'Receipt not found' });
    const orig = rows[0];
    let newDate = null;
    if (orig.date) {
      const d = new Date(orig.date);
      d.setMonth(d.getMonth() + 1);
      newDate = d.toISOString().slice(0, 10);
    }
    const ir = await fetch(`${SB_URL}/rest/v1/cr_receipts`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        storage_path: orig.storage_path,
        original_name: orig.original_name,
        amount: orig.amount,
        date: newDate,
        category: orig.category,
        description: orig.description,
        status: 'unsubmitted',
      }),
    });
    if (!ir.ok) return res.status(500).json({ error: 'Duplicate insert failed' });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
};
