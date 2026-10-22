// protech-final/public/api/promo.js
// Promo-code check + redeem for the storefront.
// Code types (promo_codes.discount):
//   'free_shipping'   -> shipping becomes 0
//   'ship_off:<EGP>'  -> that many EGP off shipping (never below 0)
// promo_codes.reusable=true -> code never burns (private/owner codes); the `used`
// flag is ignored for these (they're stored used=true so older API builds reject them).
// Enforced server-side (service_role) so a customer can't reuse a code by clearing
// their browser or switching device.
//
//   POST { code, action:'validate' }            -> { valid, code, freeShipping, shippingOff, reason }
//   POST { code, action:'redeem', orderId, phone } -> { ok, code }   (atomic single-use)
//
// Env: SUPABASE_URL, SUPABASE_KEY (service_role).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Accept messy input: Arabic-Indic digits, reversed order, extra spaces/dashes.
// Canonical form is "بروتيك-####".
function normalizeCode(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48));
  const digits = (s.match(/[0-9]/g) || []).join('');
  const hasPrefix = s.includes('بروتيك') || /protech/i.test(s);
  if (hasPrefix && digits.length === 4) return 'بروتيك-' + digits;
  return s.toUpperCase();
}

// 'ship_off:100' -> 100; anything else -> 0 (free shipping).
function parseShipOff(discount) {
  const m = /^ship_off:(\d+)$/.exec(String(discount || ''));
  return m ? Number(m[1]) : 0;
}

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const d = await r.json().catch(() => null);
  return Array.isArray(d) ? d : [];
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Server not configured' });

  const { code, action, orderId, phone } = req.body || {};
  const norm = normalizeCode(code);
  if (!norm) return res.status(400).json({ valid: false, reason: 'اكتب كود الخصم' });

  try {
    if (action === 'redeem') {
      if (!orderId) return res.status(400).json({ ok: false, reason: 'Missing orderId' });
      // Only redeem against a real order (blocks burning codes without ordering).
      const ord = await sbGet(`orders?id=eq.${encodeURIComponent(orderId)}&select=id&limit=1`);
      if (!ord.length) return res.status(400).json({ ok: false, reason: 'Order not found' });
      // Reusable codes never burn.
      const meta = await sbGet(`promo_codes?code=eq.${encodeURIComponent(norm)}&select=reusable&limit=1`);
      if (meta.length && meta[0].reusable) return res.status(200).json({ ok: true, code: norm, reusable: true });
      // Atomic single-use: the used=false filter means only the FIRST redeem wins.
      const r = await fetch(`${SUPABASE_URL}/rest/v1/promo_codes?code=eq.${encodeURIComponent(norm)}&used=eq.false`, {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json', Prefer: 'return=representation',
        },
        body: JSON.stringify({ used: true, used_at: new Date().toISOString(), order_id: String(orderId), used_by_phone: phone ? String(phone) : null }),
      });
      const rows = await r.json().catch(() => []);
      const redeemed = Array.isArray(rows) && rows.length > 0;
      return res.status(200).json({ ok: redeemed, code: norm });
    }

    // Default: validate (no state change).
    const rows = await sbGet(`promo_codes?code=eq.${encodeURIComponent(norm)}&select=code,used,discount,reusable&limit=1`);
    if (!rows.length) return res.status(200).json({ valid: false, reason: 'كود غير صحيح' });
    const row = rows[0];
    if (row.used && !row.reusable) return res.status(200).json({ valid: false, reason: 'هذا الكود مستخدم من قبل' });
    const shippingOff = parseShipOff(row.discount);
    return res.status(200).json({ valid: true, code: row.code, freeShipping: shippingOff === 0, shippingOff });
  } catch (e) {
    console.error('promo error', e.message);
    return res.status(500).json({ valid: false, reason: 'خطأ في الخادم' });
  }
}
