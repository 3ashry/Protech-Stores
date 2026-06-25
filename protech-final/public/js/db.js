// ── SUPABASE CONFIG ──
const SUPABASE_URL = 'https://wljxplbcfoorqpoflcdz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zsHh-eOarHI7BSGtuP6WWQ_PQ4ACoHG';

// ── AUTH (real Supabase Auth — no hardcoded password) ──
// Create your login user in Supabase → Authentication → Users (email + password).
// The dashboard signs in with it and uses the returned JWT for all DB access,
// so Row Level Security can restrict everything to authenticated admins.
let isLoggedIn = false;
let accessToken = sessionStorage.getItem('pt_access') || null;
let refreshToken = localStorage.getItem('pt_refresh') || null;

function setSession(d) {
  accessToken = d.access_token;
  refreshToken = d.refresh_token;
  sessionStorage.setItem('pt_access', accessToken);
  localStorage.setItem('pt_refresh', refreshToken);
  sessionStorage.setItem('pt_auth', '1');
}

function clearSession() {
  accessToken = null; refreshToken = null;
  sessionStorage.removeItem('pt_access');
  localStorage.removeItem('pt_refresh');
  sessionStorage.removeItem('pt_auth');
}

async function refreshSession() {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    if (!res.ok) { clearSession(); return false; }
    const d = await res.json();
    if (!d.access_token) { clearSession(); return false; }
    setSession(d);
    return true;
  } catch { return false; }
}

function showApp() {
  isLoggedIn = true;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  loadAll();
  try { const a = new Audio('/cash.mp3'); a.volume = 0; a.play().catch(()=>{}); } catch(e) {}
  setTimeout(() => { if (window.OneSignal) OneSignal.Notifications.requestPermission(); }, 3000);
}

async function doLogin() {
  const email = document.getElementById('l-user').value.trim();
  const pass = document.getElementById('l-pass').value;
  const errEl = document.getElementById('login-error');
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.access_token) throw new Error('bad credentials');
    setSession(d);
    showApp();
    showToast('Welcome back, Protech! 🔧');
  } catch {
    errEl.style.display = 'block';
    errEl.textContent = 'Incorrect email or password.';
    document.getElementById('l-pass').value = '';
  }
}

async function doLogout() {
  if (!confirm('Are you sure you want to log out?')) return;
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + (accessToken || SUPABASE_ANON_KEY) }
    });
  } catch (e) {}
  clearSession();
  isLoggedIn = false;
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('l-pass').value = '';
}

// Restore an existing session on load by refreshing the stored token.
(async () => {
  if (refreshToken && await refreshSession()) {
    showApp();
  }
})();

// Keep the access token fresh (Supabase access tokens expire ~1h).
setInterval(() => { if (refreshToken) refreshSession(); }, 45 * 60 * 1000);

// Allow Enter key on login
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('l-pass')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('l-user')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('l-pass').focus();
  });
});

// ── DB LAYER ──
// Uses Supabase REST API directly (no SDK needed)
// Falls back to localStorage if Supabase not configured yet

const USE_SUPABASE = SUPABASE_URL !== 'YOUR_SUPABASE_URL';

// Build headers for Supabase requests — supports both sb_publishable_ and eyJ key formats
function sbHeaders(extra = {}) {
  return {
    'apikey': SUPABASE_ANON_KEY,
    // Use the signed-in admin's JWT when available so RLS sees an authenticated user;
    // fall back to the publishable key (used only for reads before login / if RLS is open).
    'Authorization': 'Bearer ' + (accessToken || SUPABASE_ANON_KEY),
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...extra
  };
}

async function dbFetch(table, options = {}) {
  if (!USE_SUPABASE) return localGet(table);
  const { filter, order } = options;
  let url = `${SUPABASE_URL}/rest/v1/${table}?select=*`;
  if (filter) url += `&${filter}`;
  if (order) url += `&order=${order}`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function dbInsert(table, data) {
  if (!USE_SUPABASE) return localInsert(table, data);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders({ 'Prefer': 'return=representation' }),
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function dbUpdate(table, id, data) {
  if (!USE_SUPABASE) return localUpdate(table, id, data);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: sbHeaders({ 'Prefer': 'return=representation' }),
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function dbDelete(table, id) {
  if (!USE_SUPABASE) return localDelete(table, id);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: sbHeaders()
  });
  if (!res.ok) throw new Error(await res.text());
}

// ── LOCAL STORAGE FALLBACK ──
function localGet(table) {
  try { return JSON.parse(localStorage.getItem('pt_' + table) || '[]'); }
  catch { return []; }
}
function localSave(table, data) {
  localStorage.setItem('pt_' + table, JSON.stringify(data));
}
function localInsert(table, item) {
  const rows = localGet(table);
  item.id = item.id || Date.now().toString(36) + Math.random().toString(36).slice(2);
  rows.push(item);
  localSave(table, rows);
  return [item];
}
function localUpdate(table, id, data) {
  const rows = localGet(table);
  const idx = rows.findIndex(r => r.id === id);
  if (idx >= 0) { rows[idx] = { ...rows[idx], ...data }; localSave(table, rows); return [rows[idx]]; }
  return [];
}
function localDelete(table, id) {
  const rows = localGet(table).filter(r => r.id !== id);
  localSave(table, rows);
}

// ── IN-MEMORY CACHE ──
let cache = { products: [], orders: [], expenses: [], feedbacks: [] };

async function loadAll() {
  try {
    const [products, orders, expenses, feedbacks] = await Promise.all([
      dbFetch('products', { order: 'created_at.asc' }),
      dbFetch('orders', { order: 'created_at.desc' }),
      dbFetch('expenses', { order: 'created_at.desc' }),
      dbFetch('feedbacks', { order: 'created_at.desc' })
    ]);
    cache.products = products || [];
    cache.orders = orders || [];
    cache.expenses = expenses || [];
    cache.feedbacks = feedbacks || [];
  } catch (e) {
    console.warn('DB load error:', e);
    showToast('Connection error — check your internet');
  }

  renderAll();


  // Auto-refresh every 30 seconds
  if (!window._autoRefreshStarted) {
    window._autoRefreshStarted = true;
    setInterval(async () => {
      try {
        const [products, orders, expenses, feedbacks] = await Promise.all([
          dbFetch('products', { order: 'created_at.asc' }),
          dbFetch('orders', { order: 'created_at.desc' }),
          dbFetch('expenses', { order: 'created_at.desc' }),
          dbFetch('feedbacks', { order: 'created_at.desc' })
        ]);
        cache.products = products || [];
        cache.orders = orders || [];
        cache.expenses = expenses || [];
        cache.feedbacks = feedbacks || [];
        // Check for new orders and notify
        const prevCount = parseInt(sessionStorage.getItem("protech_order_count") || "0");
        if (orders && orders.length > prevCount && prevCount !== 0) {
          const newestOrder = orders[0];
          sendPushNotification(
            newestOrder.customer_name,
            newestOrder.total,
            newestOrder.code
          );
        }
        renderAll();
      } catch(e) {}
    }, 30000);
  }
}

async function sendPushNotification(customerName, total, orderCode) {
  try {
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerName, total, orderCode })
    });
  } catch(e) {
    console.warn('Push notification failed:', e);
  }
}
