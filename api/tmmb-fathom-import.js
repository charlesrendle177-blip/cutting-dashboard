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
  // Fathom transcript endpoint returns array of {speaker:{display_name}, text, timestamp}
  const items = Array.isArray(data) ? data : (data.transcript || data.items || data.data || null);
  if (Array.isArray(items)) {
    return items.map(seg => {
      const name = seg.speaker?.display_name || seg.speaker || seg.name || '';
      const text = seg.text || seg.content || '';
      return `${name}: ${text}`;
    }).join('\n');
  }
  if (data.text) return data.text;
  return JSON.stringify(data).slice(0, 8000);
}

const VALID_OUTCOMES = new Set(['closed', 'followup', 'noclose', 'noshow', 'dq']);
const VALID_SOURCES  = new Set(['setter', 'referral', 'ad', 'inbound', 'other']);
const VALID_OBJECTIONS = new Set([
  'fear-money', 'fear-think', 'fear-doubt', 'tried-before', 'logic-time', 'logic-partner', 'value',
]);

// Never trust the model's output shape directly — coerce/drop anything that
// doesn't match what the frontend and downstream totals expect, rather than
// letting a bad extraction corrupt real commission/cash data.
function sanitizeExtracted(raw) {
  const toNum = v => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
    return null;
  };

  if (!raw.is_sales_call || !raw.prospect_name) {
    return { is_sales_call: false };
  }

  return {
    is_sales_call:  true,
    prospect_name:  String(raw.prospect_name).slice(0, 200),
    prospect_email: typeof raw.prospect_email === 'string' ? raw.prospect_email.slice(0, 200) : null,
    outcome:        VALID_OUTCOMES.has(raw.outcome) ? raw.outcome : 'followup',
    deal_value:     toNum(raw.deal_value),
    cash_collected: toNum(raw.cash_collected),
    programme:      typeof raw.programme === 'string' ? raw.programme.slice(0, 200) : null,
    lead_source:    VALID_SOURCES.has(raw.lead_source) ? raw.lead_source : 'other',
    notes:          typeof raw.notes === 'string' ? raw.notes.slice(0, 500) : '',
    objections:     Array.isArray(raw.objections) ? raw.objections.filter(o => VALID_OBJECTIONS.has(o)) : [],
  };
}

async function analyseTranscript(transcript, title, anthropicKey, debug = false) {
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
        content: `Analyse this call transcript. The salesperson is Charles Rendle selling a high-ticket fitness coaching programme (TMMB Academy or Project Gains).

First decide: is this actually a sales/discovery call with a prospect for one of those programmes? It is NOT if it's an internal/team meeting, a personal call, a client check-in for someone already enrolled, or anything else that isn't a new-prospect sales conversation. When in doubt, say no — a missed call is far cheaper than a fake log entry.

Meeting title: ${title}

Transcript:
${transcript.slice(0, 9000)}

Return ONLY valid JSON with these fields:
{
  "is_sales_call":   true or false,
  "prospect_name":   "full name of the prospect (not Charles Rendle), or null if is_sales_call is false",
  "prospect_email":  "prospect's email if mentioned, else null",
  "outcome":         "one of: closed, followup, noclose, noshow, dq — or null if is_sales_call is false",
  "deal_value":      "total deal value in GBP as a plain integer if closed, else null — NEVER a string",
  "cash_collected":  "cash collected today in GBP as a plain integer if closed, else null — NEVER a string",
  "programme":       "exact programme name e.g. TMMB Academy, Project Gains, or null",
  "lead_source":     "one of: setter, referral, ad, inbound, other — infer from context (setter = booked by a setter/VA, referral = word of mouth, ad = paid ad/Facebook/Instagram, inbound = prospect reached out directly), or null",
  "notes":           "1 sentence on Charles's performance only — what he did well or poorly on this specific call. Sales skills, not prospect summary. Null if is_sales_call is false",
  "objections":      "array of any that applied: fear-money, fear-think, fear-doubt, tried-before, logic-time, logic-partner, value — empty array if none or is_sales_call is false"
}`,
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude analysis failed: ${res.status} — ${err.slice(0, 200)}`);
  }

  const data      = await res.json();
  // Opus 5 uses adaptive thinking — content[0] may be a thinking block, find the text block
  const textBlock = data.content?.find(b => b.type === 'text');
  const text      = (textBlock?.text || '').trim();
  const match   = text.match(/\{[\s\S]*\}/);
  const jsonStr = match ? match[0] : '{}';
  if (debug) return { _raw_claude: text, _json_str: jsonStr };
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Claude JSON parse failed: ${e.message}. Raw: ${text.slice(0, 200)}`);
  }
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
        id:    c.recording_id,
        title: c.title || c.meeting_title || 'Untitled Call',
        date:  (c.created_at || c.recording_start_time || '').slice(0, 10),
        url:   c.share_url || c.url || '',
      })).filter(c => c.id);
      return res.status(200).json({ calls });
    }

    if (action === 'analyse') {
      if (!id)           return res.status(400).json({ error: 'Missing id parameter' });
      if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel env vars' });

      // title and date passed from the frontend to avoid an extra API round-trip
      const { title: qTitle, date: qDate, url: qUrl } = req.query;

      // Get transcript directly from the recordings endpoint
      const tData    = await fathomGet(`/recordings/${id}/transcript`, fathomKey);
      const transcript = extractTranscriptText(tData);

      if (!transcript) throw new Error('Empty transcript returned from Fathom');

      const raw       = await analyseTranscript(transcript, qTitle || 'Sales Call', anthropicKey);
      const extracted = sanitizeExtracted(raw);

      if (!extracted.is_sales_call) {
        return res.status(200).json({ is_sales_call: false });
      }

      return res.status(200).json({
        ...extracted,
        fathom_url:   qUrl  || `https://fathom.video/calls/${id}`,
        meeting_date: qDate || '',
      });
    }

    return res.status(400).json({ error: 'Invalid action — use ?action=list or ?action=analyse&id=CALL_ID' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
