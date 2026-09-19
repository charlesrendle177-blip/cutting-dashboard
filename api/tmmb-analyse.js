// Two related Claude-API proxies merged into one function to stay under
// Vercel's Hobby plan serverless-function limit — branches on whether
// `pipeline` is present in the request body:
//
//   { transcript, pipeline: [...] } -> development-pipeline card review
//   (was api/dev-analyse.js, reached via /api/dev-analyse)
//
//   { transcript } only -> sales call scoring
//   (was api/tmmb-analyse.js, reached via /api/tmmb-analyse)

const CALL_SYSTEM = `You are a sales call coach for TMMB, a TikTok Shop creator academy selling at £4,000. The closer is Charles Rendle. You analyse call transcripts and give direct, actionable feedback. B2C high-ticket sales: hesitation is almost always emotional, not logical — fear, self-doubt, past failure. Logic closes B2B. Emotion closes B2C.

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

const PIPELINE_SYSTEM = `You are a sales coach reviewing Charles Rendle's call against his personal development pipeline. Charles sells the TMMB Academy at £4,000 for 12 months.

You will receive:
1. Charles's current development pipeline — each card has an id, label, and current column: "red" (fix now), "orange" (work on), "green" (doing well)
2. A call transcript

Your task: assess the cards in "red" and "orange" for evidence of improvement or regression. Only flag "green" cards if you see clear regression.

Rules:
- Only include cards where you found concrete evidence in the transcript
- "suggested" must be "red", "orange", or "green" — it can be the same as "current" (meaning: stay)
- Move UP (red→orange, orange→green) only with clear, consistent evidence of improvement
- Move BACK (orange→red, green→orange) only if the old pattern visibly returned
- When unsure, suggest staying in the same column
- Keep "reason" to 1–2 sentences max
- "evidence" should be a short direct quote from the transcript (under 20 words), or omit it if none found
- Return ONLY valid JSON with no other text or markdown

Response format:
{
  "recommendations": [
    {
      "id": "d1",
      "label": "Stop saying \\"100%\\"",
      "current": "red",
      "suggested": "orange",
      "reason": "Charles used 100% only once and caught himself — clear improvement vs previous calls.",
      "evidence": "Actually, that makes sense — sorry, I mean, I understand completely."
    }
  ]
}`;

async function callClaude(system, userContent, maxTokens) {
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  const data = await upstream.json();
  if (!upstream.ok) {
    const err = new Error(data.error?.message || 'Anthropic API error');
    err.status = upstream.status;
    throw err;
  }
  const text = (data.content || []).map(b => b.text || '').join('').trim();
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { transcript, pipeline } = req.body || {};
  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 50) {
    return res.status(400).json({ error: 'Transcript too short or missing' });
  }

  try {
    if (pipeline && Array.isArray(pipeline)) {
      const pipelineSummary = pipeline
        .map(c => `[${c.col.toUpperCase()}] ${c.id}: ${c.label}`)
        .join('\n');
      const result = await callClaude(
        PIPELINE_SYSTEM,
        `Charles's development pipeline:\n\n${pipelineSummary}\n\n---\n\nCall transcript:\n\n${transcript}`,
        2000
      );
      return res.status(200).json(result);
    }

    const result = await callClaude(
      CALL_SYSTEM,
      `Analyse this sales call transcript:\n\n${transcript.slice(0, 12000)}`,
      1000
    );
    return res.status(200).json({ result });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
