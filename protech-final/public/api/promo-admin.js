// protech-final/public/api/promo-admin.js
// Admin: create a single-use free-shipping promo code.
//
// Usage (GET, easiest — hit from a browser):
//   /api/promo-admin?key=<CRON_SECRET>              → auto-generates a code
//   /api/promo-admin?key=<CRON_SECRET>&code=بروتيك-1234   → creates that specific code
//
// The storefront's promo.js already treats every row as free-shipping-eligible
// and enforces single-use (used=true after redeem). All we do here is INSERT
// a new row with used=false. Response includes { ok, code } — share `code`
// with the customer as-is; the checkout also accepts Latin "protech-1234" or
// Arabic-Indic digits, they're all normalised server-side.
//
// Env: SUPABASE_URL, SUPABASE_KEY (service_role), CRON_SECRET.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const CRON_SECRET = (process.env.CRON_SECRET || '').trim();

function random4() {
  // Avoid leading zero so a Latin "protech-XXXX" of the same 4 digits stays 4 chars.
  return String(1000 + Math.floor(Math.random() * 9000));
}

async function codeExists(code) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/promo_codes?code=eq.${encodeURIComponent(code)}&select=code&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

async function insertCode(code) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/promo_codes`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: JSON.stringify({ code, used: false }),
  });
  const body = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, body };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const key = ((req.query && (req.query.key || req.query.secret)) || '').toString().trim();
  if (!CRON_SECRET || key !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'DB not configured' });

  try {
    const requested = ((req.query && req.query.code) || '').toString().trim();
    let code = requested;
    if (code) {
      // If they passed just 4 digits, wrap them in the canonical prefix.
      if (/^\d{4}$/.test(code)) code = `بروتيك-${code}`;
      if (await codeExists(code)) return res.status(409).json({ ok: false, code, reason: 'code already exists' });
      const ins = await insertCode(code);
      if (!ins.ok) return res.status(500).json({ ok: false, code, error: ins.body });
      return res.status(200).json({ ok: true, code, message: `Created single-use free-shipping code: ${code}` });
    }
    // Auto-generate: try up to 20 random 4-digit codes to avoid collisions.
    for (let i = 0; i < 20; i++) {
      const c = `بروتيك-${random4()}`;
      if (await codeExists(c)) continue;
      const ins = await insertCode(c);
      if (!ins.ok) return res.status(500).json({ ok: false, code: c, error: ins.body });
      return res.status(200).json({ ok: true, code: c, message: `Created single-use free-shipping code: ${c}` });
    }
    return res.status(500).json({ ok: false, error: 'Could not find a free code slot after 20 tries' });
  } catch (e) {
    console.error('promo-admin error', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
