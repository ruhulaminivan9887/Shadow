require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3002;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// -------------------- Supabase --------------------
const supabaseAdmin = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'ruhulaminivan@gmail.com';

app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
    googleConfigured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    microsoftConfigured: !!(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET)
  });
});

async function requireAuth(req, res, next) {
  if (!supabaseAdmin) return res.status(501).json({ error: 'auth_not_configured' });
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'not_authenticated' });
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'invalid_session' });
  req.user = data.user;
  next();
}

async function isPro(userId, email) {
  if (email === ADMIN_EMAIL) return true;
  if (!supabaseAdmin || !userId) return false;
  const { data } = await supabaseAdmin.from('subscriptions').select('status').eq('user_id', userId).eq('status', 'active').maybeSingle();
  return !!data;
}

app.get('/api/me', requireAuth, async (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, pro: await isPro(req.user.id, req.user.email), isAdmin: req.user.email === ADMIN_EMAIL });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------- Known AI tool catalog --------------------
const AI_TOOL_CATALOG = [
  { match: /chatgpt|openai/i, name: 'ChatGPT / OpenAI', category: 'General AI Assistant', risk: 'high' },
  { match: /claude|anthropic/i, name: 'Claude', category: 'General AI Assistant', risk: 'medium' },
  { match: /perplexity/i, name: 'Perplexity AI', category: 'AI Search', risk: 'medium' },
  { match: /jasper/i, name: 'Jasper AI', category: 'Content Generation', risk: 'medium' },
  { match: /copy\.ai/i, name: 'Copy.ai', category: 'Content Generation', risk: 'medium' },
  { match: /gamma/i, name: 'Gamma', category: 'Presentation AI', risk: 'medium' },
  { match: /otter\.ai/i, name: 'Otter.ai', category: 'Meeting Transcription', risk: 'high' },
  { match: /grammarly/i, name: 'Grammarly', category: 'Writing Assistant', risk: 'low' },
  { match: /github copilot|copilot/i, name: 'GitHub Copilot', category: 'Code Generation', risk: 'medium' },
  { match: /notion ?ai/i, name: 'Notion AI', category: 'Productivity AI', risk: 'low' },
  { match: /midjourney/i, name: 'Midjourney', category: 'Image Generation', risk: 'low' },
  { match: /synthesia/i, name: 'Synthesia', category: 'Video AI', risk: 'medium' },
  { match: /fireflies/i, name: 'Fireflies.ai', category: 'Meeting Transcription', risk: 'high' },
  { match: /elevenlabs/i, name: 'ElevenLabs', category: 'Voice AI', risk: 'low' },
  { match: /huggingface|hugging face/i, name: 'Hugging Face', category: 'AI Development Platform', risk: 'medium' }
];

function matchAiTool(name) {
  for (const tool of AI_TOOL_CATALOG) {
    if (tool.match.test(name)) return tool;
  }
  return null;
}

// -------------------- Google Workspace OAuth --------------------
function googleOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${BASE_URL}/auth/google/callback`
  );
}

app.get('/auth/google/connect', requireAuth, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(501).send('Google OAuth not configured on this server.');
  const oauth2Client = googleOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
      'https://www.googleapis.com/auth/admin.directory.user.security'
    ],
    state: req.user.id
  });
  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const oauth2Client = googleOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    if (supabaseAdmin) {
      await supabaseAdmin.from('org_connections').upsert({
        user_id: state, provider: 'google',
        refresh_token: tokens.refresh_token, access_token: tokens.access_token,
        connected_at: new Date().toISOString()
      }, { onConflict: 'user_id,provider' });
    }
    res.redirect('/?connected=google');
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    res.redirect('/?error=google_connect_failed');
  }
});

// -------------------- Microsoft 365 OAuth --------------------
app.get('/auth/microsoft/connect', requireAuth, (req, res) => {
  if (!process.env.MS_CLIENT_ID) return res.status(501).send('Microsoft OAuth not configured on this server.');
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: `${BASE_URL}/auth/microsoft/callback`,
    response_mode: 'query',
    scope: 'offline_access https://graph.microsoft.com/Application.Read.All https://graph.microsoft.com/Directory.Read.All',
    state: req.user.id
  });
  res.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`);
});

app.get('/auth/microsoft/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MS_CLIENT_ID,
        client_secret: process.env.MS_CLIENT_SECRET,
        code, redirect_uri: `${BASE_URL}/auth/microsoft/callback`,
        grant_type: 'authorization_code'
      })
    });
    const tokens = await tokenRes.json();
    if (tokens.error) throw new Error(tokens.error_description || tokens.error);
    if (supabaseAdmin) {
      await supabaseAdmin.from('org_connections').upsert({
        user_id: state, provider: 'microsoft',
        refresh_token: tokens.refresh_token, access_token: tokens.access_token,
        connected_at: new Date().toISOString()
      }, { onConflict: 'user_id,provider' });
    }
    res.redirect('/?connected=microsoft');
  } catch (err) {
    console.error('Microsoft OAuth callback error:', err);
    res.redirect('/?error=microsoft_connect_failed');
  }
});

app.get('/api/connections', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json([]);
  const { data } = await supabaseAdmin.from('org_connections').select('provider, connected_at').eq('user_id', req.user.id);
  res.json(data || []);
});

// -------------------- Shadow AI discovery --------------------
async function discoverGoogleApps(userId) {
  const { data: conn } = await supabaseAdmin.from('org_connections').select('*').eq('user_id', userId).eq('provider', 'google').maybeSingle();
  if (!conn) return [];

  const oauth2Client = googleOAuthClient();
  oauth2Client.setCredentials({ refresh_token: conn.refresh_token, access_token: conn.access_token });
  const admin = google.admin({ version: 'directory_v1', auth: oauth2Client });

  const usersRes = await admin.users.list({ customer: 'my_customer', maxResults: 50 });
  const users = usersRes.data.users || [];

  const appMap = new Map();
  for (const user of users.slice(0, 25)) {
    try {
      const tokensRes = await admin.tokens.list({ userKey: user.primaryEmail });
      (tokensRes.data.items || []).forEach(tok => {
        const key = tok.clientId;
        if (!appMap.has(key)) appMap.set(key, { name: tok.displayText || tok.clientId, users: new Set(), scopes: tok.scopes || [] });
        appMap.get(key).users.add(user.primaryEmail);
      });
    } catch (err) { /* skip users with no visible tokens */ }
  }
  return Array.from(appMap.values()).map(a => ({ name: a.name, userCount: a.users.size, scopes: a.scopes, source: 'Google Workspace' }));
}

async function discoverMicrosoftApps(userId) {
  const { data: conn } = await supabaseAdmin.from('org_connections').select('*').eq('user_id', userId).eq('provider', 'microsoft').maybeSingle();
  if (!conn) return [];

  const res = await fetch('https://graph.microsoft.com/v1.0/servicePrincipals?$top=200', {
    headers: { Authorization: `Bearer ${conn.access_token}` }
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);

  return (data.value || [])
    .filter(sp => sp.appOwnerOrganizationId)
    .slice(0, 100)
    .map(sp => ({ name: sp.displayName, userCount: null, scopes: (sp.oauth2PermissionScopes || []).map(s => s.value), source: 'Microsoft 365' }));
}

app.get('/api/discover', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(501).json({ error: 'db_not_configured' });
  try {
    const [googleApps, msApps] = await Promise.all([
      discoverGoogleApps(req.user.id).catch(err => { console.error('Google discover error:', err.message); return []; }),
      discoverMicrosoftApps(req.user.id).catch(err => { console.error('Microsoft discover error:', err.message); return []; })
    ]);
    const allApps = [...googleApps, ...msApps];
    const flagged = allApps.map(a => {
      const match = matchAiTool(a.name);
      return { ...a, isAiTool: !!match, aiCategory: match?.category || null, risk: match?.risk || 'unclassified' };
    });
    const counts = { high: 0, medium: 0, low: 0 };
    flagged.filter(a => a.isAiTool).forEach(a => { if (counts[a.risk] !== undefined) counts[a.risk]++; });
    res.json({ apps: flagged, aiToolCount: flagged.filter(a => a.isAiTool).length, totalApps: flagged.length, counts, scannedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: 'discover_failed', message: err.message });
  }
});

// -------------------- AI Governance Briefing --------------------
app.post('/api/briefing', requireAuth, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(501).json({ error: 'ai_not_configured' });
  const { apps, counts, totalApps } = req.body;
  const aiApps = (apps || []).filter(a => a.isAiTool);
  const prompt = `You are an AI governance consultant briefing a company leader on shadow AI usage discovered in their Google Workspace / Microsoft 365 tenant.

Total third-party apps found: ${totalApps}
AI tools identified: ${aiApps.length}
Risk breakdown: ${counts.high} high risk, ${counts.medium} medium risk, ${counts.low} low risk
Specific AI tools found: ${aiApps.map(a => `${a.name} (${a.aiCategory}, ${a.userCount || '?'} users)`).join('; ') || 'none'}

Write a 4-5 sentence executive briefing: current AI exposure posture in plain language, the single most urgent tool to review first (name it if a high-risk one exists), and one concrete governance recommendation following a "governed enablement" approach (sanction safe use, don't just ban). Professional, direct, no unexplained jargon.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 400, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await response.json();
    const text = (data.content || []).map(b => b.text || '').join('\n').trim();
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// -------------------- Stripe --------------------
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

app.post('/api/create-checkout-session', requireAuth, async (req, res) => {
  if (!stripe) return res.status(501).json({ error: 'stripe_not_configured' });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      client_reference_id: req.user.id,
      customer_email: req.user.email,
      success_url: `${req.headers.origin}/?upgraded=true`,
      cancel_url: `${req.headers.origin}/?upgraded=false`,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(501).end();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (!supabaseAdmin) return res.json({ received: true });
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.client_reference_id) {
      await supabaseAdmin.from('subscriptions').upsert({
        user_id: session.client_reference_id, status: 'active', stripe_customer_id: session.customer, updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
    }
  }
  if (event.type === 'customer.subscription.deleted') {
    await supabaseAdmin.from('subscriptions').update({ status: 'inactive', updated_at: new Date().toISOString() }).eq('stripe_customer_id', event.data.object.customer);
  }
  if (event.type === 'customer.subscription.updated') {
    const isActive = ['active', 'trialing'].includes(event.data.object.status);
    await supabaseAdmin.from('subscriptions').update({ status: isActive ? 'active' : 'inactive', updated_at: new Date().toISOString() }).eq('stripe_customer_id', event.data.object.customer);
  }
  res.json({ received: true });
});

app.listen(PORT, () => console.log(`ShadowLens server running on port ${PORT}`));

process.on('unhandledRejection', (err) => console.error('Unhandled rejection (kept server alive):', err));
process.on('uncaughtException', (err) => console.error('Uncaught exception (kept server alive):', err));
