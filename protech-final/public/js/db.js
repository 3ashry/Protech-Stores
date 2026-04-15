// ── SUPABASE CONFIG ──
const SUPABASE_URL = 'https://wljxplbcfoorqpoflcdz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zsHh-eOarHI7BSGtuP6WWQ_PQ4ACoHG';

// ── ADMIN CREDENTIALS ──
// ⚠️ IMPORTANT: Replace CHANGE_THIS_PASSWORD with your real password before uploading
const ADMIN_USER = 'mahmoudelashry4597@gmail.com';
const ADMIN_PASS = 'CHANGE_THIS_PASSWORD';

// ── AUTH ──
let isLoggedIn = false;

function doLogin() {
  const user = document.getElementById('l-user').value.trim();
  const pass = document.getElementById('l-pass').value;
  const errEl = document.getElementById('login-error');
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    isLoggedIn = true;
    sessionStorage.setItem('pt_auth', '1');
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    renderAll();
    showToast('Welcome back, Protech! 🔧');
  } else {
    errEl.style.display = 'block';
    errEl.textContent = 'Incorrect username or password.';
    document.getElementById('l-pass').value = '';
  }
}

function doLogout() {
  if (!confirm('Are you sure you want to log out?')) return;
  isLoggedIn = false;
  sessionStorage.removeItem('pt_auth');
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('l-pass').value = '';
}

// Check if already logged in this session
if (sessionStorage.getItem('pt_auth') === '1') {
  isLoggedIn = true;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}

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
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: sbHeaders({ 'Prefer': 'return=representation' }),
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function dbDelete(table, id) {
  if (!USE_SUPABASE) return localDelete(table, id);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
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
}
