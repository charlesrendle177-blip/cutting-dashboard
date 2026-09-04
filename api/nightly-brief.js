// Nightly pre-call brief + weekly performance digest for TMMB sales calls.
// Called by a scheduled cloud agent every day at 7pm UK time (checks tomorrow's calendar).
// Accepts optional POST body: { calls: ["3:00 PM", "9:00 PM"] } — times from calendar.
// REQUIRES Vercel env vars: RESEND_API_KEY, RESEND_FROM_EMAIL

/* ================================================================
   WEEKLY DIGEST
   ================================================================ */
const SB_URL  = 'https://rxwmfssdvpilfvbpbrrq.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4d21mc3NkdnBpbGZ2YnBicnJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNDY3NjQsImV4cCI6MjA5MTkyMjc2NH0.mG9jnkxhvcXonICd6BAkjCxNDiJJ_xfcJORQIaQuztw';

function weekBounds(weeksAgo = 0) {
  const now = new Date();
  const day = now.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + mondayOffset - weeksAgo * 7);
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

async function sbFetch(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` },
  });
  if (!res.ok) throw new Error(`Supabase ${path}: ${res.status}`);
  return res.json();
}

async function analyseWeek(thisWeek, lastWeek, recentNotes, anthropicKey) {
  const fmt = rows => rows.map(c =>
    `${c.call_date} | ${c.prospect_name || 'Unknown'} | ${c.outcome} | ${c.notes || 'no notes'}`
  ).join('\n') || 'None logged.';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are reviewing Charles Rendle's TMMB sales performance. Charles sells high-ticket fitness coaching.

THIS WEEK (${thisWeek.length} calls):
${fmt(thisWeek)}

LAST WEEK (${lastWeek.length} calls):
${fmt(lastWeek)}

LAST 20 CALL NOTES (pattern analysis):
${recentNotes.map(c => `${c.call_date}: ${c.notes}`).filter(x => x.includes(':')).join('\n') || 'None.'}

Return ONLY valid JSON:
{
  "best_call_name": "prospect name or null",
  "best_call_date": "YYYY-MM-DD or null",
  "best_call_reason": "1 sentence on what Charles did well",
  "worst_call_name": "prospect name or null",
  "worst_call_date": "YYYY-MM-DD or null",
  "worst_call_reason": "1 sentence on what went wrong — Charles's skills only",
  "one_fix": "The single most important thing to work on next week. Specific, actionable, no fluff.",
  "patterns": ["recurring gap 1", "recurring gap 2", "recurring gap 3"]
}`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Claude analysis: ${res.status}`);
  const data = await res.json();
  const textBlock = data.content?.find(b => b.type === 'text');
  const text = (textBlock?.text || '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : {};
}

function buildDigestHtml(thisWeek, lastWeek, analysis) {
  const closeRate = arr => arr.length ? arr.filter(c => c.outcome === 'closed').length / arr.length : 0;
  const thisRate  = closeRate(thisWeek);
  const lastRate  = closeRate(lastWeek);
  const delta     = thisRate - lastRate;
  const deltaSign = delta >= 0 ? '+' : '';
  const deltaClr  = delta >= 0 ? '#16a34a' : '#dc2626';
  const pct = r => Math.round(r * 100) + '%';
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });

  const patternsHtml = (analysis.patterns || []).map(p =>
    `<li style="margin-bottom:6px;font-size:13px;color:#374151;">${p}</li>`
  ).join('');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Weekly Digest</title></head>
<body style="margin:0;padding:0;background:#f0f2f7;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:580px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0d2345;padding:32px 40px;">
    <div style="font-size:11px;font-weight:700;color:#60a5fa;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">Weekly Digest</div>
    <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">TMMB Performance Review</div>
    <div style="font-size:13px;color:#93c5fd;margin-top:4px;">${today}</div>
  </div>
  <div style="padding:32px 40px;">
    <div style="margin-bottom:28px;">
      <div style="font-size:11px;font-weight:800;color:#1e40af;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #eff6ff;">Close Rate</div>
      <div style="display:flex;gap:12px;">
        <div style="flex:1;background:#f0f9ff;border-radius:10px;padding:16px;text-align:center;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;margin-bottom:6px;">This Week</div>
          <div style="font-size:30px;font-weight:800;color:#0d2345;">${pct(thisRate)}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">${thisWeek.length} calls</div>
        </div>
        <div style="flex:1;background:#f8fafc;border-radius:10px;padding:16px;text-align:center;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;margin-bottom:6px;">Last Week</div>
          <div style="font-size:30px;font-weight:800;color:#6b7280;">${pct(lastRate)}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">${lastWeek.length} calls</div>
        </div>
        <div style="flex:1;background:${delta >= 0 ? '#f0fdf4' : '#fef2f2'};border-radius:10px;padding:16px;text-align:center;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;margin-bottom:6px;">Change</div>
          <div style="font-size:30px;font-weight:800;color:${deltaClr};">${deltaSign}${pct(delta)}</div>
        </div>
      </div>
    </div>
    ${analysis.best_call_name ? `
    <div style="margin-bottom:28px;">
      <div style="font-size:11px;font-weight:800;color:#1e40af;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #eff6ff;">Best Call</div>
      <div style="background:#f0fdf4;border-left:3px solid #16a34a;border-radius:0 8px 8px 0;padding:14px 16px;">
        <div style="font-size:14px;font-weight:700;color:#0d2345;">${analysis.best_call_name} &mdash; ${analysis.best_call_date || ''}</div>
        <div style="font-size:13px;color:#374151;margin-top:6px;">${analysis.best_call_reason || ''}</div>
      </div>
    </div>` : ''}
    ${analysis.worst_call_name ? `
    <div style="margin-bottom:28px;">
      <div style="font-size:11px;font-weight:800;color:#1e40af;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #eff6ff;">Worst Call</div>
      <div style="background:#fef2f2;border-left:3px solid #dc2626;border-radius:0 8px 8px 0;padding:14px 16px;">
        <div style="font-size:14px;font-weight:700;color:#0d2345;">${analysis.worst_call_name} &mdash; ${analysis.worst_call_date || ''}</div>
        <div style="font-size:13px;color:#374151;margin-top:6px;">${analysis.worst_call_reason || ''}</div>
      </div>
    </div>` : ''}
    ${analysis.one_fix ? `
    <div style="margin-bottom:28px;">
      <div style="font-size:11px;font-weight:800;color:#1e40af;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #eff6ff;">Fix This Week</div>
      <div style="background:#0d2345;border-radius:12px;padding:18px 20px;">
        <div style="font-size:15px;font-weight:700;color:#fff;line-height:1.6;">${analysis.one_fix}</div>
      </div>
    </div>` : ''}
    ${patternsHtml ? `
    <div style="margin-bottom:16px;">
      <div style="font-size:11px;font-weight:800;color:#1e40af;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #eff6ff;">Recurring Patterns</div>
      <ul style="margin:0;padding-left:20px;">${patternsHtml}</ul>
    </div>` : ''}
  </div>
</div>
</body></html>`;
}

/* ================================================================
   NIGHTLY BRIEF helpers
   ================================================================ */
function getTomorrowLabel() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
}

function buildBriefHtml(tomorrow, calls = []) {
  const callsHtml = calls.length > 0
    ? calls.map(c => `
      <div class="call-slot">
        <div class="call-dot"></div>
        <span class="call-time">${c}</span>
      </div>`).join('')
    : `<div class="call-fallback">Calls confirmed — check your calendar for times.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pre-Call Brief — ${tomorrow}</title>
<style>
  body { margin:0; padding:0; background:#f0f2f7; font-family:'Helvetica Neue',Arial,sans-serif; }
  .wrap { max-width:580px; margin:40px auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
  .header { background:#0d2345; padding:32px 40px; }
  .header-label { font-size:11px; font-weight:700; color:#60a5fa; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:6px; }
  .header-title { font-size:22px; font-weight:800; color:#fff; letter-spacing:-0.5px; }
  .header-date { font-size:13px; color:#93c5fd; margin-top:4px; }
  .body { padding:32px 40px; }
  .section { margin-bottom:28px; }
  .section-title { font-size:11px; font-weight:800; color:#1e40af; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:14px; padding-bottom:8px; border-bottom:2px solid #eff6ff; }
  .call-slot { display:flex; align-items:center; gap:10px; padding:10px 14px; background:#f0f9ff; border-radius:8px; border-left:3px solid #1e40af; margin-bottom:8px; }
  .call-slot:last-child { margin-bottom:0; }
  .call-dot { width:8px; height:8px; border-radius:50%; background:#1e40af; flex-shrink:0; }
  .call-time { font-size:16px; font-weight:700; color:#0d2345; }
  .call-fallback { font-size:14px; color:#6b7280; padding:4px 0; }
  .fix-item { display:flex; gap:12px; padding:10px 0; border-bottom:1px solid #f3f4f6; }
  .fix-item:last-child { border-bottom:none; }
  .fix-num { width:24px; height:24px; border-radius:50%; background:#1e40af; color:#fff; font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-top:1px; }
  .fix-body strong { font-size:14px; font-weight:700; color:#0d2345; display:block; margin-bottom:3px; }
  .fix-body span { font-size:13px; color:#6b7280; line-height:1.5; }
  .state-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .state-box { background:#f8fafc; border-radius:10px; padding:12px 14px; }
  .state-box strong { font-size:13px; font-weight:700; color:#0d2345; display:block; margin-bottom:3px; }
  .state-box span { font-size:12px; color:#6b7280; line-height:1.4; }
  .mantra-box { background:#0d2345; border-radius:12px; padding:18px 20px; text-align:center; }
  .mantra-box p { font-size:15px; font-weight:700; color:#fff; margin:0; line-height:1.6; }
  .mantra-box span { color:#60a5fa; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="header-label">Pre-Call Brief</div>
    <div class="header-title">TMMB · Tomorrow's Prep</div>
    <div class="header-date">${tomorrow}</div>
  </div>
  <div class="body">

    <div class="section">
      <div class="section-title">Tomorrow's calls</div>
      ${callsHtml}
    </div>

    <div class="section">
      <div class="section-title">Your Fix List — burn this in</div>
      <div class="fix-item">
        <div class="fix-num">1</div>
        <div class="fix-body">
          <strong>Slow down</strong>
          <span>Especially the framing at the top and anything that matters. Breathe. Aaron's first note, every time.</span>
        </div>
      </div>
      <div class="fix-item">
        <div class="fix-num">2</div>
        <div class="fix-body">
          <strong>Ask "why" earlier and more</strong>
          <span>Don't construct clever questions. Just say why. You waited 20+ minutes last time — don't repeat it.</span>
        </div>
      </div>
      <div class="fix-item">
        <div class="fix-num">3</div>
        <div class="fix-body">
          <strong>Stay in emotional moments</strong>
          <span>When you get there, sit in it. Don't retreat back into logistics, numbers, and timelines.</span>
        </div>
      </div>
      <div class="fix-item">
        <div class="fix-num">4</div>
        <div class="fix-body">
          <strong>Don't accept half answers</strong>
          <span>Press every vague one. "What do you mean by that?" — every time, no exceptions.</span>
        </div>
      </div>
      <div class="fix-item">
        <div class="fix-num">5</div>
        <div class="fix-body">
          <strong>Micro-recap constantly</strong>
          <span>"Okay so [their answer], right?" after every discovery question. Buys thinking time, builds trust, slows your pace.</span>
        </div>
      </div>
      <div class="fix-item">
        <div class="fix-num">6</div>
        <div class="fix-body">
          <strong>Store what they give you — use it later</strong>
          <span>Bank every detail, every pain point, every personal moment. Plant them at objection time.</span>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">State going in</div>
      <div class="state-grid">
        <div class="state-box">
          <strong>Pace</strong>
          <span>You talk fast under pressure. Conscious slow-down at every transition.</span>
        </div>
        <div class="state-box">
          <strong>Curiosity</strong>
          <span>You're here to understand, not to pitch. Discovery first, always.</span>
        </div>
        <div class="state-box">
          <strong>Silence</strong>
          <span>After you ask something hard — shut up. Let it land.</span>
        </div>
        <div class="state-box">
          <strong>Detachment</strong>
          <span>You don't need this close. That energy closes more calls than any line.</span>
        </div>
      </div>
    </div>

  </div>
</div>
</body>
</html>`;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!resendKey || !fromEmail) {
    return res.status(500).json({ error: 'RESEND_API_KEY or RESEND_FROM_EMAIL not set' });
  }

  // ── Weekly digest mode ──────────────────────────────────────────
  if (req.query?.mode === 'weekly') {
    const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();
    if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

    try {
      const thisBounds = weekBounds(0);
      const lastBounds = weekBounds(1);
      const fields = 'call_date,prospect_name,outcome,deal_value,notes';
      const [thisWeek, lastWeek, recentNotes] = await Promise.all([
        sbFetch(`tmmb_calls?call_date=gte.${thisBounds.start}&call_date=lte.${thisBounds.end}&order=call_date.asc&select=${fields}`),
        sbFetch(`tmmb_calls?call_date=gte.${lastBounds.start}&call_date=lte.${lastBounds.end}&order=call_date.asc&select=${fields}`),
        sbFetch(`tmmb_calls?notes=not.is.null&order=call_date.desc&limit=20&select=call_date,notes`),
      ]);

      if (!thisWeek.length && !lastWeek.length) {
        return res.status(200).json({ ok: true, skipped: true, reason: 'No calls logged yet' });
      }

      const analysis = await analyseWeek(thisWeek, lastWeek, recentNotes, anthropicKey);
      const html     = buildDigestHtml(thisWeek, lastWeek, analysis);
      const today    = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });

      const r    = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from:    `TMMB Sales <${fromEmail}>`,
          to:      ['charlesrendle177@gmail.com'],
          subject: `Weekly Digest — ${today}`,
          html,
        }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(500).json({ error: data.message });
      return res.status(200).json({ ok: true, resendId: data.id, thisWeek: thisWeek.length, lastWeek: lastWeek.length });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Nightly brief mode (original) ──────────────────────────────
  const apiKey = resendKey;

  let calls = [];
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      if (Array.isArray(body.calls)) calls = body.calls.map(String);
    } catch { /* ignore — calls stays empty */ }
  }

  const tomorrow = getTomorrowLabel();
  const html = buildBriefHtml(tomorrow, calls);

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `TMMB Sales <${fromEmail}>`,
      to: ['charlesrendle177@gmail.com'],
      subject: `Pre-Call Brief — ${tomorrow}`,
      html,
    }),
  });

  const data = await r.json();
  if (!r.ok) return res.status(500).json({ error: data.message, detail: data });
  return res.status(200).json({ ok: true, resendId: data.id, tomorrow, calls });
};
