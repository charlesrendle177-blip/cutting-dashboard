// Calls Claude Haiku to extract receipt data (amount, date, merchant, category) from a base64 PDF.
// Requires Vercel env var: ANTHROPIC_API_KEY

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { base64 } = body;
  if (!base64) return res.status(400).json({ error: 'base64 required' });
  if (base64.length > 10_000_000) return res.status(413).json({ error: 'PDF too large (max ~7.5 MB)' });

  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            },
            {
              type: 'text',
              text: 'Extract from this receipt or invoice. Return ONLY a valid JSON object with exactly these fields: {"amount": <number or null — GBP total, no currency symbol>, "date": "<YYYY-MM-DD or null>", "merchant": "<company or shop name or null>", "category": "<one of: software, marketing, equipment, professional, travel, office, subscriptions, meals, other>"}. No markdown, no explanation, JSON only.',
            },
          ],
        }],
      }),
    });
  } catch (e) {
    return res.status(500).json({ error: 'Claude API request failed' });
  }

  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    return res.status(500).json({ error: `Claude API error ${r.status}`, detail: errText });
  }

  const data = await r.json();
  const text = data?.content?.[0]?.text || '{}';

  let extracted = {};
  try {
    const clean = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
    extracted = JSON.parse(clean);
  } catch {
    extracted = {};
  }

  return res.status(200).json({ ok: true, ...extracted });
};
