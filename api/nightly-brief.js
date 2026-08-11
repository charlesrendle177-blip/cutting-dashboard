// Nightly pre-call brief for TMMB sales calls.
// Called by a scheduled cloud agent every day at 7pm UK time (checks tomorrow's calendar).
// Accepts optional POST body: { calls: ["3:00 PM", "9:00 PM"] } — times from calendar.
// REQUIRES Vercel env vars: RESEND_API_KEY, RESEND_FROM_EMAIL

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

  const apiKey    = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    return res.status(500).json({ error: 'RESEND_API_KEY or RESEND_FROM_EMAIL not set' });
  }

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
