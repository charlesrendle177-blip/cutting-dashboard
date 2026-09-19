// WHOOP OAuth callback — exchanges the authorization code for tokens and
// stores them in the whoop_tokens table (service-role only, never exposed
// to the browser's anon key). Visit once to authorize; after that
// whoop-sync.js refreshes the token itself.
// REQUIRES Vercel env vars: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, SUPABASE_SERVICE_ROLE_KEY

const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const SB_URL = 'https://rxwmfssdvpilfvbpbrrq.supabase.co';
const REDIRECT_URI = 'https://cutting-dashboard.vercel.app/api/whoop-callback';

async function storeTokens(tokens, serviceKey) {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const r = await fetch(`${SB_URL}/rest/v1/whoop_tokens?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      id: 1,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!r.ok) throw new Error(`Token store failed (${r.status}): ${await r.text()}`);
}

module.exports = async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`WHOOP authorization failed: ${error} — ${error_description || ''}`);
  }
  if (!code) {
    return res.status(400).send('Missing authorization code.');
  }

  const clientId     = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!clientId || !clientSecret) {
    return res.status(500).send('WHOOP_CLIENT_ID or WHOOP_CLIENT_SECRET not set in Vercel env vars.');
  }
  if (!serviceKey) {
    return res.status(500).send('SUPABASE_SERVICE_ROLE_KEY not set in Vercel env vars.');
  }

  try {
    const tokenRes = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.status(500).send(`Token exchange failed (${tokenRes.status}): ${JSON.stringify(tokens)}`);
    }

    await storeTokens(tokens, serviceKey);

    return res.status(200).send('WHOOP connected. You can close this tab — daily sync will now run automatically.');
  } catch (e) {
    return res.status(500).send(`Error: ${e.message}`);
  }
};
