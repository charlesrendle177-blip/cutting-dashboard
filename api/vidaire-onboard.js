// Vidaire client onboarding proxy.
// Replicates onboardClient() from Vidaire's lib/clients.ts — atomic create with full rollback.
// Then fires a welcome email to the client via Resend.
//
// REQUIRES Vercel env vars (add to cutting-dashboard Vercel project):
//   VIDAIRE_SUPABASE_URL
//   VIDAIRE_SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY          (copy from Vidaire Vercel project)
//   RESEND_FROM_EMAIL       (copy from Vidaire Vercel project)
// NEVER hardcode these — this repo is public.

const { createClient } = require('@supabase/supabase-js');

function makeAdmin() {
  const url = process.env.VIDAIRE_SUPABASE_URL;
  const key = process.env.VIDAIRE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Vidaire Supabase credentials not configured in Vercel env vars');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function generateTempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*';
  let pw = '';
  for (let i = 0; i < 16; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

async function authUserExists(admin, email) {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    if (data.users.some(u => u.email?.toLowerCase() === target)) return true;
    if (data.users.length < 200) break;
  }
  return false;
}

function welcomeEmailHtml({ clientName, contactName, loginEmail, tempPassword }) {
  const loginUrl = 'https://vidaire.co.uk';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Welcome to Vidaire</title>
<style>
  body { margin:0; padding:0; background:#f0f2f7; font-family:'Helvetica Neue',Arial,sans-serif; }
  .wrap { max-width:580px; margin:40px auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
  .header { background:#0d2345; padding:36px 40px 32px; }
  .logo { font-size:22px; font-weight:800; color:#fff; letter-spacing:-0.5px; }
  .logo span { color:#60a5fa; }
  .body { padding:36px 40px; }
  h1 { font-size:22px; font-weight:800; color:#0d2345; margin:0 0 8px; }
  p { font-size:15px; color:#374151; line-height:1.7; margin:0 0 20px; }
  .cred-box { background:#f0f9ff; border:1px solid rgba(14,165,233,0.25); border-radius:10px; padding:18px 20px; margin:24px 0; }
  .cred-row { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(0,0,0,0.06); font-size:14px; }
  .cred-row:last-child { border-bottom:none; }
  .cred-label { color:#6b7280; font-weight:600; }
  .cred-val { color:#0c4a6e; font-weight:700; font-family:monospace; }
  .login-btn { display:block; background:#1e40af; color:#fff; text-align:center; padding:14px; border-radius:10px; font-weight:700; font-size:15px; text-decoration:none; margin:24px 0; }
  .timeline { border-left:3px solid #e5e7eb; margin:24px 0; padding-left:20px; }
  .tl-item { position:relative; margin-bottom:18px; }
  .tl-item:last-child { margin-bottom:0; }
  .tl-dot { position:absolute; left:-27px; top:3px; width:10px; height:10px; border-radius:50%; background:#1e40af; border:2px solid #fff; box-shadow:0 0 0 2px #e5e7eb; }
  .tl-label { font-size:11px; font-weight:800; color:#1e40af; text-transform:uppercase; letter-spacing:0.07em; margin-bottom:3px; }
  .tl-text { font-size:14px; color:#374151; line-height:1.5; }
  .loom-box { background:#eff6ff; border:1px solid rgba(30,64,175,0.15); border-radius:10px; padding:16px 18px; margin:20px 0; }
  .loom-box h3 { font-size:13px; font-weight:800; color:#1e40af; margin:0 0 8px; text-transform:uppercase; letter-spacing:0.06em; }
  .loom-format { font-size:18px; font-weight:800; color:#0d2345; font-family:monospace; letter-spacing:0.05em; }
  .loom-eg { font-size:13px; color:#6b7280; margin-top:6px; }
  .footer { background:#f8fafc; padding:24px 40px; border-top:1px solid rgba(0,0,0,0.06); }
  .footer p { font-size:13px; color:#9ca3af; margin:0; line-height:1.6; }
  .footer a { color:#1e40af; }
  .warn { font-size:13px; color:#92400e; background:#fffbeb; border:1px solid rgba(217,119,6,0.2); border-radius:8px; padding:12px 14px; margin-top:20px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">vid<span>aire</span></div>
  </div>
  <div class="body">
    <h1>You're in, ${contactName}.</h1>
    <p>Welcome to Vidaire — your cold outreach command centre is ready. Here's everything you need to get started, and what's happening over the next few weeks.</p>

    <div class="cred-box">
      <div style="font-size:11px;font-weight:800;color:#0369a1;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px;">Your login credentials</div>
      <div class="cred-row">
        <span class="cred-label">Dashboard</span>
        <span class="cred-val">${loginUrl}</span>
      </div>
      <div class="cred-row">
        <span class="cred-label">Email</span>
        <span class="cred-val">${loginEmail}</span>
      </div>
      <div class="cred-row">
        <span class="cred-label">Temp password</span>
        <span class="cred-val">${tempPassword}</span>
      </div>
    </div>

    <div class="warn">⚠️ You'll be prompted to set a new password on first login. Do this before closing the tab.</div>

    <a href="${loginUrl}" class="login-btn">Open your dashboard →</a>

    <p style="font-size:15px;font-weight:700;color:#0d2345;margin-bottom:16px;">What happens over the next 21 days</p>
    <div class="timeline">
      <div class="tl-item">
        <div class="tl-dot"></div>
        <div class="tl-label">Right now — Day 1</div>
        <div class="tl-text">Your sending domain is being configured (DNS, SPF, DKIM). Your outreach inboxes are created and begin warming.</div>
      </div>
      <div class="tl-item">
        <div class="tl-dot"></div>
        <div class="tl-label">Days 2–21</div>
        <div class="tl-text">Inbox warming continues. This is non-negotiable — skipping it kills deliverability. No outreach goes out during this window.</div>
      </div>
      <div class="tl-item">
        <div class="tl-dot"></div>
        <div class="tl-label">Week 3 — Campaign live</div>
        <div class="tl-text">First batch of personalised Loom videos goes out to your lead list. Your dashboard will show opens, replies, and video views in real time.</div>
      </div>
      <div class="tl-item">
        <div class="tl-dot" style="background:#059669;box-shadow:0 0 0 2px rgba(5,150,105,0.2);"></div>
        <div class="tl-label" style="color:#059669;">Ongoing</div>
        <div class="tl-text">You'll get an email the moment a lead watches your video. That's your signal to follow up fast.</div>
      </div>
    </div>

    <div class="loom-box">
      <h3>Loom video naming — non-negotiable</h3>
      <div class="loom-format">FirstName-LastName-DD-MM</div>
      <div class="loom-eg">e.g. <strong>John-Smith-05-08</strong> — this is how we match views back to your leads automatically. Wrong format = broken tracking.</div>
    </div>

    <p>Any questions before we go live — reply here or reach me directly:</p>
    <p style="margin:0;"><strong>Charles</strong><br><a href="mailto:charles@vidaire.co.uk" style="color:#1e40af;">charles@vidaire.co.uk</a></p>
  </div>
  <div class="footer">
    <p>You're receiving this because ${clientName} was onboarded to Vidaire today.<br>
    <a href="${loginUrl}">vidaire.co.uk</a></p>
  </div>
</div>
</body>
</html>`;
}

async function sendWelcomeEmail({ clientName, contactName, loginEmail, tempPassword, toEmail }) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !fromEmail) return { skipped: true, reason: 'RESEND_API_KEY or RESEND_FROM_EMAIL not set' };

  const html = welcomeEmailHtml({ clientName, contactName, loginEmail, tempPassword });
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Vidaire <${fromEmail}>`,
      to: [toEmail],
      subject: `Welcome to Vidaire — you're set up, ${contactName}`,
      html,
    }),
  });
  const data = await r.json();
  return { ok: r.ok, status: r.status, resendId: data.id, error: data.message };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const {
    name, industry_type, mrr, start_date, notes,
    contact_name, contact_email, notification_email,
    sending_domain, instantly_campaign_id, loom_folder_id,
  } = body || {};

  const errors = [];
  if (!name?.trim()) errors.push('Client name is required');
  if (!contact_name?.trim()) errors.push('Contact name is required');
  if (!contact_email?.trim()) errors.push('Contact email is required');
  if (!notification_email?.trim()) errors.push('Notification email is required');
  if (!sending_domain?.trim()) errors.push('Sending domain is required');
  if (!instantly_campaign_id?.trim()) errors.push('Instantly campaign ID is required');
  if (errors.length) return res.status(422).json({ error: errors.join(', ') });

  let admin;
  try {
    admin = makeAdmin();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const contactEmail = contact_email.trim();

  try {
    if (await authUserExists(admin, contactEmail)) {
      return res.status(409).json({ error: 'A user with this email already exists in Vidaire' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Failed to check existing users: ' + e.message });
  }

  const temporaryPassword = generateTempPassword();

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: contactEmail,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { client_name: name.trim() },
  });
  if (authError || !authData?.user) {
    return res.status(500).json({ error: authError?.message ?? 'Failed to create auth user' });
  }
  const userId = authData.user.id;

  let client;
  try {
    const { data, error } = await admin.from('clients').insert({
      name: name.trim(),
      industry_type: industry_type || null,
      status: 'onboarding',
      mrr: mrr ? Number(mrr) : null,
      start_date: start_date || null,
      notes: notes || null,
      contact_name: contact_name.trim(),
      contact_email: contactEmail,
      notification_email: notification_email.trim(),
      sending_domain: sending_domain.trim(),
      instantly_campaign_id: instantly_campaign_id.trim(),
      loom_folder_id: loom_folder_id?.trim() || null,
    }).select('*').single();
    if (error) throw error;
    client = data;
  } catch (e) {
    await admin.auth.admin.deleteUser(userId);
    return res.status(500).json({ error: 'Failed to create client row: ' + e.message });
  }

  try {
    const { error } = await admin.from('profiles').insert({
      id: userId,
      client_id: client.client_id,
      is_admin: false,
      must_change_password: true,
    });
    if (error) throw error;
  } catch (e) {
    await admin.from('clients').delete().eq('client_id', client.client_id);
    await admin.auth.admin.deleteUser(userId);
    return res.status(500).json({ error: 'Failed to link profile: ' + e.message });
  }

  try {
    const { error } = await admin.from('admin_tasks').insert({
      text: `Set ${name.trim()} live — upload first Loom batch and activate Instantly campaign`,
      priority: 'high',
      category: 'Operations',
    });
    if (error) throw error;
  } catch (e) {
    await admin.from('profiles').delete().eq('id', userId);
    await admin.from('clients').delete().eq('client_id', client.client_id);
    await admin.auth.admin.deleteUser(userId);
    return res.status(500).json({ error: 'Failed to create admin task: ' + e.message });
  }

  // Welcome email — non-fatal if it fails; client is already created
  const emailResult = await sendWelcomeEmail({
    clientName: name.trim(),
    contactName: contact_name.trim(),
    loginEmail: contactEmail,
    tempPassword: temporaryPassword,
    toEmail: contactEmail,
  });

  return res.status(200).json({
    client,
    credentials: { email: contactEmail, temporaryPassword },
    welcomeEmail: emailResult,
  });
};
