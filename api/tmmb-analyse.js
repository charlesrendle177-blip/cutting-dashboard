const SYSTEM = `You are a sales call coach for TMMB, a TikTok Shop creator academy selling at £4,000. The closer is Charles Rendle. You analyse call transcripts and give direct, actionable feedback. B2C high-ticket sales: hesitation is almost always emotional, not logical — fear, self-doubt, past failure. Logic closes B2B. Emotion closes B2C.

Always respond in this EXACT JSON format with no other text, no markdown:
{
  "overall_score": 7,
  "rapport": 8,
  "diagnosis": 6,
  "pain_amplification": 5,
  "close_attempt": 7,
  "summary": "One sentence on the call overall",
  "what_worked": ["point 1", "point 2", "point 3"],
  "to_improve": ["point 1", "point 2"],
  "objections_hit": ["objection 1", "objection 2"],
  "key_moment": "The single most important moment in this call",
  "next_step": "Exactly what Charles should do next with this prospect"
}`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  }

  const { transcript } = req.body || {};
  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 50) {
    return res.status(400).json({ error: 'Transcript too short or missing' });
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Analyse this sales call transcript:\n\n${transcript.slice(0, 12000)}` }]
      })
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data.error?.message || 'Anthropic API error' });
    }

    const text = (data.content || []).map(b => b.text || '').join('').trim();
    const result = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.status(200).json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
