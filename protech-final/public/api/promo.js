// protech-final/public/api/promo.js
// Promo-code check + redeem for the storefront. Free-shipping codes, single use.
// Enforced server-side (service_role) so a customer can't reuse a code by clearing
// their browser or switching device.
//
//   POST { code, action:'validate' }            -> { valid, code, freeShipping, reason }
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
  return s;
}

// Loose key for comparing Arabic codes: customers type أ/إ/آ vs ا, ة vs ه,
// ى vs ي, add tashkeel/tatweel, spaces, dashes or underscores, Arabic digits.
function looseKey(raw) {
  return String(raw || '')
    .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48))
    .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48))
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[\s_\-ـ.]+/g, '')
    .toLowerCase();
}

// What a code gives, from promo_codes.discount:
//   'free_shipping'                 → free shipping
//   'product_off:<amount>:min<price>' → <amount> EGP off the order if the cart has
//                                      a product priced at <price> or more
function describe(discount) {
  const d = String(discount || 'free_shipping');
  let m = d.match(/^product_off:(\d+(?:\.\d+)?):min(\d+(?:\.\d+)?)$/);
  if (m) return { kind: 'product_off', amount: +m[1], minItemPrice: +m[2], freeShipping: false };
  if (d === 'free_shipping') return { kind: 'free_shipping', freeShipping: true };
  return null;   // a type this checkout doesn't support → not accepted
}

// Find a code: exact match first (the single-use بروتيك-#### codes), then the
// reusable codes compared loosely.
async function findCode(norm) {
  const exact = await sbGet(`promo_codes?code=eq.${encodeURIComponent(norm)}&select=code,used,reusable,discount&limit=1`);
  if (exact.length) return exact[0];
  const reusable = await sbGet('promo_codes?reusable=eq.true&select=code,used,reusable,discount');
  const k = looseKey(norm);
  return reusable.find(r => looseKey(r.code) === k) || null;
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
      // Reusable codes are never "used up" — the order itself records promo_code.
      const found = await findCode(norm);
      if (found && found.reusable) return res.status(200).json({ ok: !found.used, code: found.code, reusable: true });
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
    const row = await findCode(norm);
    if (!row) return res.status(200).json({ valid: false, reason: 'كود غير صحيح' });
    // For a reusable code, used=true means it has been switched off.
    if (row.used) return res.status(200).json({ valid: false, reason: row.reusable ? 'هذا الكود غير متاح حالياً' : 'هذا الكود مستخدم من قبل' });
    const info = describe(row.discount);
    if (!info) return res.status(200).json({ valid: false, reason: 'هذا الكود غير متاح حالياً' });
    return res.status(200).json({ valid: true, code: row.code, reusable: !!row.reusable, ...info });
  } catch (e) {
    console.error('promo error', e.message);
    return res.status(500).json({ valid: false, reason: 'خطأ في الخادم' });
  }
}
