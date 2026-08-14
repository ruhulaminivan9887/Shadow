const $ = (s) => document.querySelector(s);
let authMode = 'login';
let lastDiscoverData = null;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

function apiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const token = getAccessToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}
function escapeHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ============== Auth UI ==============
function openAuthModal(mode) {
  authMode = mode;
  $('#authTitle').textContent = mode === 'login' ? 'Log in' : 'Create your account';
  $('#authSubmit').textContent = mode === 'login' ? 'Log in' : 'Sign up';
  $('#authToggleText').textContent = mode === 'login' ? 'No account?' : 'Already have an account?';
  $('#authToggleLink').textContent = mode === 'login' ? 'Sign up' : 'Log in';
  $('#authModal').classList.add('show');
}

function renderAuthArea() {
  const user = getCurrentUser();
  const area = $('#authArea');
  if (user) {
    area.innerHTML = `<span class="usage-pill">${escapeHtml(user.email.split('@')[0])}</span> <button class="btn btn-ghost btn-sm" id="logoutBtn">Log out</button>`;
    $('#logoutBtn').addEventListener('click', async () => { await signOut(); toast('Logged out.'); });
  } else {
    area.innerHTML = `<button class="btn btn-ghost btn-sm" id="loginBtn">Log in</button>`;
    $('#loginBtn').addEventListener('click', () => openAuthModal('login'));
  }
}

async function onAuthChange(user) {
  renderAuthArea();
  if (user) $('#authModal').classList.remove('show');
  refreshMe();
}

function bindEvents() {
  $('#closeAuthModal').addEventListener('click', () => $('#authModal').classList.remove('show'));
  $('#authToggleLink').addEventListener('click', (e) => { e.preventDefault(); openAuthModal(authMode === 'login' ? 'signup' : 'login'); });
  $('#googleBtn').addEventListener('click', async () => { try { await signInGoogle(); } catch (err) { toast('Google sign-in failed: ' + err.message); } });
  $('#authSubmit').addEventListener('click', async () => {
    try {
      const email = $('#authEmail').value.trim();
      const password = $('#authPassword').value;
      if (!email || !password) { toast('Enter email and password.'); return; }
      const { error } = authMode === 'login' ? await signInEmail(email, password) : await signUpEmail(email, password);
      if (error) { toast(error.message); return; }
      toast(authMode === 'login' ? 'Logged in ✅' : 'Account created — check your email to verify.');
    } catch (err) { toast('Unexpected error: ' + err.message); }
  });

  $('#connectGoogle').addEventListener('click', () => {
    if (!getCurrentUser()) { openAuthModal('login'); toast('Log in first.'); return; }
    window.location.href = `/auth/google/connect?token=${encodeURIComponent(getAccessToken())}`;
  });
  $('#connectMicrosoft').addEventListener('click', () => {
    if (!getCurrentUser()) { openAuthModal('login'); toast('Log in first.'); return; }
    window.location.href = `/auth/microsoft/connect?token=${encodeURIComponent(getAccessToken())}`;
  });
  $('#discoverBtn').addEventListener('click', runDiscovery);

  $('#upgradeBtn').addEventListener('click', () => $('#paywallModal').classList.add('show'));
  $('#closePaywall').addEventListener('click', () => $('#paywallModal').classList.remove('show'));
  $('#checkoutBtn').addEventListener('click', startCheckout);
}

// ============== Discovery ==============
async function runDiscovery() {
  if (!getCurrentUser()) { openAuthModal('login'); toast('Log in first.'); return; }
  const btn = $('#discoverBtn');
  btn.disabled = true;
  btn.textContent = '⟳ Scanning...';
  $('#appsTable').innerHTML = '<div class="empty-state">Querying connected providers...</div>';
  try {
    const res = await fetch('/api/discover', { headers: apiHeaders() });
    const data = await res.json();
    if (data.error) { toast(data.message || data.error); $('#appsTable').innerHTML = `<div class="empty-state">${escapeHtml(data.message || data.error)}</div>`; return; }
    lastDiscoverData = data;
    renderStats(data);
    renderAppsTable(data.apps);
    fetchBriefing(data);
  } catch (err) {
    toast('Discovery failed — server unreachable.');
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ Run Discovery Scan';
  }
}

function renderStats(data) {
  $('#statsRow').innerHTML = `
    <div class="stat-card"><div class="stat-num">${data.totalApps}</div><div class="stat-label">TOTAL APPS FOUND</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--accent)">${data.aiToolCount}</div><div class="stat-label">AI TOOLS DETECTED</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--high)">${data.counts.high}</div><div class="stat-label">HIGH RISK</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--medium)">${data.counts.medium}</div><div class="stat-label">MEDIUM RISK</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--low)">${data.counts.low}</div><div class="stat-label">LOW RISK</div></div>
  `;
}

function renderAppsTable(apps) {
  if (!apps.length) { $('#appsTable').innerHTML = '<div class="empty-state">No third-party apps found. Connect a provider and try again.</div>'; return; }
  $('#appsTable').innerHTML = apps.map(a => `
    <div class="app-row ${a.isAiTool ? 'ai-flagged' : ''}">
      <div><div class="app-name">${escapeHtml(a.name)}</div><div class="app-category">${a.aiCategory || a.source}</div></div>
      <div class="app-users">${a.userCount !== null ? a.userCount + ' users' : ''}</div>
      <div class="app-users">${a.source}</div>
      <span class="risk-badge risk-${a.risk}">${a.risk.toUpperCase()}</span>
    </div>
  `).join('');
}

async function fetchBriefing(data) {
  $('#briefingWrap').innerHTML = `<div class="briefing-panel"><div class="briefing-title">AI GOVERNANCE BRIEFING</div><div class="briefing-text">Analyzing exposure...</div></div>`;
  try {
    const res = await fetch('/api/briefing', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(data) });
    if (res.status === 402) { $('#paywallModal').classList.add('show'); return; }
    const briefing = await res.json();
    $('#briefingWrap').innerHTML = briefing.text
      ? `<div class="briefing-panel"><div class="briefing-title">AI GOVERNANCE BRIEFING</div><div class="briefing-text">${briefing.text}</div></div>`
      : '';
  } catch (err) { $('#briefingWrap').innerHTML = ''; }
}

// ============== Pro / Stripe ==============
async function refreshMe() {
  if (!getCurrentUser()) return;
  try {
    const res = await fetch('/api/me', { headers: apiHeaders() });
    const me = await res.json();
    if (me.pro) { $('#usagePill').textContent = '✨ Pro'; $('#upgradeBtn').style.display = 'none'; }
    else { $('#usagePill').textContent = 'Free plan'; $('#upgradeBtn').style.display = 'inline-flex'; }
  } catch (err) { /* ignore */ }
}

async function startCheckout() {
  if (!getCurrentUser()) { openAuthModal('login'); toast('Log in first.'); return; }
  try {
    const res = await fetch('/api/create-checkout-session', { method: 'POST', headers: apiHeaders() });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    else toast('Stripe not configured yet.');
  } catch (err) { toast('Checkout failed to start.'); }
}

// ============== Init ==============
async function init() {
  bindEvents();
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    if (cfg.supabaseUrl && cfg.supabaseAnonKey) await initAuth(cfg.supabaseUrl, cfg.supabaseAnonKey);
    else { renderAuthArea(); toast('Accounts not configured yet — set SUPABASE_URL and SUPABASE_ANON_KEY on the server.'); }
  } catch (err) { renderAuthArea(); }

  const params = new URLSearchParams(window.location.search);
  if (params.get('connected')) toast(`${params.get('connected')} connected ✅`);
  if (params.get('error')) toast(`Connection failed: ${params.get('error')}`);
}

init();
