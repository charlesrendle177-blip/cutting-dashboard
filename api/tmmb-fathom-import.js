// Fathom call import — list recent recordings and analyse transcripts via Claude
// REQUIRES Vercel env vars: FATHOM_API_KEY, ANTHROPIC_API_KEY

const FATHOM_BASE    = 'https://api.fathom.ai/external/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com';

async function fathomGet(path, apiKey) {
  const res = await fetch(`${FATHOM_BASE}${path}`, {
    headers: { 'X-Api-Key': apiKey },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Fathom ${path}: HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
  return res.json();
}

function extractTranscriptText(data) {
  if (typeof data === 'string') return data;
  if (data.transcript) return typeof data.transcript === 'string' ? data.transcript : JSON.stringify(data.transcript);
  if (data.text)       return data.text;
  if (Array.isArray(data)) {
    return data.map(seg => `${seg.speaker || seg.name || ''}: ${seg.text || seg.content || ''}`).join('\n');
  }
  return JSON.stringify(data).slice(0, 8000);
}

async function analyseTranscript(transcript, title, anthropicKey) {
  const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key':         anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-opus-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Analyse this sales call transcript. The salesperson is Charles Rendle selling a high-ticket fitness coaching programme (TMMB Academy or Project Gains).

Meeting title: ${title}

Transcript:
${transcript.slice(0, 9000)}

Return ONLY valid JSON with these fields (use null if unknown):
{
  "prospect_name":   "full name of the prospect (not Charles)",
  "prospect_email":  "prospect's email if mentioned, else null",
  "outcome":         "one of: closed, followup, noclose, noshow, dq",
  "deal_value":      "total deal value in GBP as integer if closed, else null",
  "cash_collected":  "cash collected today in GBP as integer if closed, else null",
  "programme":       "exact programme name discussed e.g. TMMB Academy, Project Gains",
  "notes":           "2–3 sentence summary: what went well, key moments, what to improve",
  "objections":      "array of any that applied: fear-money, fear-think, fear-doubt, tried-before, logic-time, logic-partner, value"
}`,
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude analysis failed: ${res.status} — ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = (data.content?.[0]?.text || '').trim();
  const jsonStr = text.startsWith('{') ? text : text.match(/\{[\s\S]*\}/)?.[0] || '{}';
  return JSON.parse(jsonStr);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const fathomKey    = (process.env.FATHOM_API_KEY    || '').trim();
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();

  if (!fathomKey) return res.status(500).json({ error: 'FATHOM_API_KEY not set in Vercel env vars' });

  const { action, id } = req.query;

  try {
    if (!action || action === 'list') {
      const data  = await fathomGet('/meetings?page_size=25', fathomKey);
      const items = Array.isArray(data) ? data : (data.data || data.meetings || data.items || []);
      const calls = items.map(c => ({
        id:       c.id,
        title:    c.title || c.name || 'Untitled Call',
        date:     (c.created_at || c.recorded_at || c.started_at || '').slice(0, 10),
        duration: c.duration,
        url:      c.url || c.recording_url || c.share_url,
      }));
      return res.status(200).json({ calls });
    }

    if (action === 'analyse') {
      if (!id)           return res.status(400).json({ error: 'Missing id parameter' });
      if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel env vars' });

      // Fetch meeting + transcript in one call
      const data = await fathomGet(`/meetings?id=${id}&include_transcript=true`, fathomKey);
      const items = Array.isArray(data) ? data : (data.data || data.meetings || []);
      const meeting = items[0] || data;

      // Fall back to dedicated transcript endpoint if not inline
      let transcript = extractTranscriptText(meeting.transcript || '');
      if (!transcript) {
        const tData = await fathomGet(`/recordings/${id}/transcript`, fathomKey);
        transcript  = extractTranscriptText(tData);
      }

      const extracted = await analyseTranscript(
        transcript,
        meeting.title || meeting.name || 'Sales Call',
        anthropicKey,
      );

      const url  = meeting.url || meeting.recording_url || meeting.share_url || `https://fathom.video/calls/${id}`;
      const date = (meeting.created_at || meeting.recorded_at || meeting.started_at || '').slice(0, 10);

      return res.status(200).json({ ...extracted, fathom_url: url, meeting_date: date });
    }

    return res.status(400).json({ error: 'Invalid action — use ?action=list or ?action=analyse&id=CALL_ID' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
