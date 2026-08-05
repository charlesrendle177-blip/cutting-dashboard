// Vidaire client onboarding proxy.
// Replicates onboardClient() from Vidaire's lib/clients.ts — atomic create with full rollback.
// REQUIRES Vercel env vars: VIDAIRE_SUPABASE_URL + VIDAIRE_SUPABASE_SERVICE_ROLE_KEY
// NEVER hardcode these values — this repo is public.

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

  return res.status(200).json({
    client,
    credentials: { email: contactEmail, temporaryPassword },
  });
};
