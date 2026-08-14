let supabaseClient = null;
let currentUser = null;
let currentSession = null;

async function initAuth(supabaseUrl, supabaseAnonKey) {
  supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  const { data: { session } } = await supabaseClient.auth.getSession();
  currentSession = session;
  currentUser = session?.user || null;

  supabaseClient.auth.onAuthStateChange((event, session) => {
    currentSession = session;
    currentUser = session?.user || null;
    onAuthChange(currentUser);
  });
  onAuthChange(currentUser);
}

async function signUpEmail(email, password) {
  if (!supabaseClient) return { error: { message: 'Accounts are not configured on this server yet (missing Supabase keys).' } };
  return supabaseClient.auth.signUp({ email, password });
}

async function signInEmail(email, password) {
  if (!supabaseClient) return { error: { message: 'Accounts are not configured on this server yet (missing Supabase keys).' } };
  return supabaseClient.auth.signInWithPassword({ email, password });
}

async function signInGoogle() {
  if (!supabaseClient) { toast('Accounts are not configured on this server yet.'); return; }
  return supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
}

async function signOut() { await supabaseClient.auth.signOut(); }
function getAccessToken() { return currentSession?.access_token || null; }
function getCurrentUser() { return currentUser; }
function onAuthChange(user) { /* overridden in app.js */ }
