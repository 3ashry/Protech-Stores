// protech-final/api/bosta.js
// Vercel Serverless Function — Create Bosta shipment after order is placed
//
// Secrets are read from environment variables (Vercel → Project → Settings →
// Environment Variables). Never hardcode keys here — this file is in source control.
import { tgNotifyOrder } from './_telegram.js';
import { sendPushForOrder } from './_push.js';
import { sendConfirmTemplate, waConfigured } from './_wa.js';

const BOSTA_API_KEY = process.env.BOSTA_API_KEY;
const BOSTA_BASE_URL = process.env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Comma-separated list of allowed browser origins, e.g.
//   ALLOWED_ORIGINS="https://protech-stores.vercel.app,https://protechstores.com"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function corsHeaders(req) {
  const origin = req.headers.origin;
  // With an allowlist configured, only echo a matching origin; otherwise fall back to '*'
  // (functional, but set ALLOWED_ORIGINS to lock this down).
  const allow = ALLOWED_ORIGINS.length
    ? (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0])
    : '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

const CITY_MAP = {
  'القاهرة':        'EG-01',
  'القاهره':        'EG-01',
  'الإسكندرية':    'EG-02',
  'الاسكندريه':    'EG-02',
  'الإسكندريه':    'EG-02',
  'الساحل الشمالي':'EG-03',
  'البحيرة':       'EG-04',
  'البحيره':       'EG-04',
  'الدقهلية':      'EG-05',
  'الدقهليه':      'EG-05',
  'القليوبية':     'EG-06',
  'القليوبيه':     'EG-06',
  'الغربية':       'EG-07',
  'الغربيه':       'EG-07',
  'كفر الشيخ':     'EG-08',
  'المنوفية':      'EG-09',
  'المنوفيه':      'EG-09',
  'الشرقية':       'EG-10',
  'الشرقيه':       'EG-10',
  'الإسماعيلية':   'EG-11',
  'الاسماعيليه':   'EG-11',
  'الإسماعيليه':   'EG-11',
  'السويس':        'EG-12',
  'بورسعيد':       'EG-13',
  'بور سعيد':      'EG-13',
  'دمياط':         'EG-14',
  'الفيوم':        'EG-15',
  'بني سويف':      'EG-16',
  'أسيوط':         'EG-17',
  'اسيوط':         'EG-17',
  'سوهاج':         'EG-18',
  'المنيا':        'EG-19',
  'قنا':           'EG-20',
  'أسوان':         'EG-21',
  'اسوان':         'EG-21',
  'الأقصر':        'EG-22',
  'الاقصر':        'EG-22',
  'البحر الأحمر':  'EG-23',
  'البحر الاحمر':  'EG-23',
  'الوادي الجديد': 'EG-24',
  'الجيزة':        'EG-25',
  'الجيزه':        'EG-25',
  'جنوب سيناء':    'EG-26',
  'شمال سيناء':    'EG-27',
  'مرسي مطروح':    'EG-28',
  'مطروح':         'EG-28',
};

// Arabic city name → English zone name (Bosta expects English for zone field)
const ZONE_MAP = {
  'القاهرة':        'Cairo',
  'القاهره':        'Cairo',
  'الإسكندرية':    'Alexandria',
  'الاسكندريه':    'Alexandria',
  'الإسكندريه':    'Alexandria',
  'الساحل الشمالي':'North Coast',
  'البحيرة':       'Behira',
  'البحيره':       'Behira',
  'الدقهلية':      'Dakahlia',
  'الدقهليه':      'Dakahlia',
  'القليوبية':     'El Kalioubia',
  'القليوبيه':     'El Kalioubia',
  'الغربية':       'Gharbia',
  'الغربيه':       'Gharbia',
  'كفر الشيخ':     'Kafr Alsheikh',
  'المنوفية':      'Monufia',
  'المنوفيه':      'Monufia',
  'الشرقية':       'Sharqia',
  'الشرقيه':       'Sharqia',
  'الإسماعيلية':   'Ismailia',
  'الاسماعيليه':   'Ismailia',
  'الإسماعيليه':   'Ismailia',
  'السويس':        'Suez',
  'بورسعيد':       'Port Said',
  'بور سعيد':      'Port Said',
  'دمياط':         'Damietta',
  'الفيوم':        'Fayoum',
  'بني سويف':      'Bani Suif',
  'أسيوط':         'Assuit',
  'اسيوط':         'Assuit',
  'سوهاج':         'Sohag',
  'المنيا':        'Menya',
  'قنا':           'Qena',
  'أسوان':         'Aswan',
  'اسوان':         'Aswan',
  'الأقصر':        'Luxor',
  'الاقصر':        'Luxor',
  'البحر الأحمر':  'Red Sea',
  'البحر الاحمر':  'Red Sea',
  'الوادي الجديد': 'New Valley',
  'الجيزة':        'Giza',
  'الجيزه':        'Giza',
  'جنوب سيناء':    'South Sinai',
  'شمال سيناء':    'North Sinai',
  'مرسي مطروح':    'Matrouh',
  'مطروح':         'Matrouh',
};

// Base shipping rates from Bosta dashboard — توصيل column, smallest size
// Final cost = base + 1% COD fee on amount above 2000 + 14% VAT on (base + fee)
const SHIPPING_RATES = {
  'EG-01': 118,  // القاهرة
  'EG-25': 118,  // الجيزة
  'EG-02': 124,  // الإسكندرية
  'EG-04': 124,  // البحيرة
  'EG-05': 131,  // الدقهلية
  'EG-06': 131,  // القليوبية
  'EG-07': 131,  // الغربية
  'EG-08': 131,  // كفر الشيخ
  'EG-09': 131,  // المنوفية
  'EG-10': 131,  // الشرقية
  'EG-14': 131,  // دمياط
  'EG-11': 131,  // الإسماعيلية
  'EG-13': 131,  // بورسعيد
  'EG-12': 131,  // السويس
  'EG-15': 146,  // الفيوم
  'EG-16': 146,  // بني سويف
  'EG-19': 146,  // المنيا
  'EG-17': 146,  // أسيوط
  'EG-18': 146,  // سوهاج
  'EG-20': 162,  // قنا
  'EG-22': 162,  // الأقصر
  'EG-21': 162,  // أسوان
  'EG-23': 162,  // البحر الأحمر
  'EG-28': 162,  // مطروح
  'EG-03': 166,  // الساحل الشمالي
  'EG-27': 182,  // شمال سيناء
  'EG-26': 182,  // جنوب سيناء
  'EG-24': 182,  // الوادي الجديد
};

// Supabase REST helper (service-role key — can update products despite RLS).
function sbFetch(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

// Decrement product stock for an order, server-side. Idempotent: if the order
// already has a ship_code we assume stock was handled and skip (prevents a second
// call from double-decrementing). Best-effort: never throws.
async function decrementStockForOrder(orderId) {
  try {
    const r = await sbFetch(`orders?id=eq.${encodeURIComponent(orderId)}&select=products,ship_code`);
    const row = (await r.json())?.[0];
    if (!row) return;
    if (row.ship_code) return; // already processed on a prior call
    const items = Array.isArray(row.products) ? row.products : [];
    for (const it of items) {
      if (!it || !it.id) continue;
      const pr = await sbFetch(`products?id=eq.${encodeURIComponent(it.id)}&select=id,qty`);
      const prow = (await pr.json())?.[0];
      if (!prow) continue;
      const newQty = Math.max(0, (parseInt(prow.qty) || 0) - (parseInt(it.qty) || 0));
      await sbFetch(`products?id=eq.${encodeURIComponent(it.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ qty: newQty }),
      });
    }
  } catch (e) {
    console.warn('decrementStockForOrder failed (order still saved):', e.message);
  }
}

export default async function handler(req, res) {
  const CORS = corsHeaders(req);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).end();

  if (!BOSTA_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error('bosta.js missing env config (BOSTA_API_KEY / SUPABASE_URL / SUPABASE_KEY)');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const { orderId, customerName, phone, secondPhone, city, address, notes, total, allowOpen } = req.body || {};

  if (!orderId || !customerName || !phone || !city || !address || !total) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // orderId is interpolated into a PostgREST filter URL below — only allow safe id chars.
  if (!/^[A-Za-z0-9_-]+$/.test(String(orderId))) {
    return res.status(400).json({ error: 'Invalid orderId' });
  }

  // Decrement stock server-side (client can't, RLS blocks anonymous product writes).
  // Runs before the ship_code is set, so the idempotency guard works on retries.
  await decrementStockForOrder(orderId);

  // Fire-and-forget Telegram alert — best-effort, never blocks or breaks the
  // Bosta flow. tgNotifyOrder no-ops silently if TELEGRAM_BOT_TOKEN / _CHAT_ID
  // aren't set in Vercel env vars.
  tgNotifyOrder({ orderId, customerName, phone, city, address, total, allowOpen })
    .catch(e => console.warn('telegram notify failed:', e && e.message));
  // Fire-and-forget Web Push to every subscribed device (the installed PWA
  // on the admin's phone). Pings the phone even when the app is closed / the
  // screen is locked. No-ops silently if VAPID keys aren't configured.
  sendPushForOrder({
    id: orderId,
    code: orderId,
    customer_name: customerName,
    city, total,
  }).catch(e => console.warn('web push failed:', e && e.message));

  const cityCode = CITY_MAP[city];
  if (!cityCode) {
    console.error(`Unknown city: "${city}"`);
    return res.status(400).json({ error: `Unknown city: "${city}"` });
  }

  const nameParts = customerName.trim().split(' ');
  const firstName = nameParts[0] || customerName;
  const lastName = nameParts.slice(1).join(' ') || '-';

  const formatEgyPhone = (raw) => {
    let s = String(raw || '').trim().replace(/\s+/g, '');
    if (!s) return '';
    if (s.startsWith('0')) return '+2' + s;
    if (!s.startsWith('+')) return '+2' + s;
    return s;
  };
  const formattedPhone = formatEgyPhone(phone);
  // Second phone is optional. Normalise with the same +2 prefix as the main
  // phone and drop it if it ends up identical to the main number (Bosta
  // rejects deliveries whose primary and secondary phones match).
  const formattedSecondPhone = (() => {
    const s = formatEgyPhone(secondPhone);
    if (!s || s === formattedPhone) return null;
    return s;
  })();

  // Real Bosta formula (matches dashboard breakdown):
  //   COD            = customer's total (which already = subtotal + shipping)
  //   cod_fee        = max(0, COD - 2000) × 0.01
  //   vat            = (base_rate + cod_fee) × 0.14
  //   shipping_total = base_rate + cod_fee + vat
  const baseRate = SHIPPING_RATES[cityCode] || 131;
  const COD = total;
  const codFee = Math.max(0, COD - 2000) * 0.01;
  const vat = (baseRate + codFee) * 0.14;
  const shippingCost = Math.ceil(baseRate + codFee + vat);

  // When allowToOpenPackage is true, Bosta (errorCode 2150) requires product
  // images so the courier can verify the item before letting the customer open
  // the package. We fetch one image per cart line from the products table and
  // attach them to specs.packageDetails.productsImages (cap at 5 — Bosta's limit).
  // If the lookup fails or returns none, we drop allowToOpenPackage rather than
  // let Bosta reject the whole shipment.
  let productsImages = [];
  if (allowOpen) {
    try {
      const orderRow = await sbFetch(`orders?id=eq.${encodeURIComponent(orderId)}&select=products`)
        .then(r => r.json()).then(rows => (Array.isArray(rows) && rows[0]) || null);
      const productIds = Array.isArray(orderRow?.products)
        ? [...new Set(orderRow.products.map(p => p && p.id).filter(Boolean))]
        : [];
      if (productIds.length) {
        const inList = productIds.map(id => `"${String(id).replace(/"/g, '')}"`).join(',');
        const prodRows = await sbFetch(`products?id=in.(${encodeURIComponent(inList)})&select=id,images`)
          .then(r => r.json()).catch(() => []);
        const byId = new Map((Array.isArray(prodRows) ? prodRows : []).map(p => [p.id, p]));
        const seen = new Set();
        for (const line of (orderRow.products || [])) {
          const p = byId.get(line && line.id);
          const first = Array.isArray(p?.images) && p.images.find(u => typeof u === 'string' && u);
          if (first && !seen.has(first)) { seen.add(first); productsImages.push(first); }
          if (productsImages.length >= 5) break;
        }
      }
    } catch (e) { console.warn('productsImages lookup failed:', e && e.message); }
    if (!productsImages.length) {
      console.warn(`bosta.js: allowToOpenPackage requested but no product images found for order ${orderId}; dropping flag so Bosta accepts the shipment.`);
    }
  }

  const bostaPayload = {
    type: 10,           // SEND with COD
    cod: total,         // Customer pays exactly this — same number shown at checkout
    specs: {
      packageType: 'Parcel',
      size: 'SMALL',
      packageDetails: {
        itemsCount: 1,
        description: 'أدوات',
        ...(productsImages.length ? { productsImages } : {}),
      },
    },
    dropOffAddress: {
      cityCode,
      zone: ZONE_MAP[city] || city,  // English zone name for Bosta
      firstLine: address,
      secondLine: address,
    },
    receiver: {
      firstName,
      lastName,
      phone: formattedPhone,
      ...(formattedSecondPhone ? { secondPhone: formattedSecondPhone } : {}),
    },
    businessReference: orderId,  // Links Bosta shipment back to our order
    notes: notes || '',
    // Only keep allowToOpenPackage on if we actually have images to back it up;
    // otherwise Bosta rejects the whole shipment with errorCode 2150.
    allowToOpenPackage: !!(allowOpen && productsImages.length),
  };

  // ─────────────────────────────────────────────────────────────────────
  // STEP 1 — WhatsApp confirmation goes out FIRST, independently of Bosta.
  // The customer gets their "you ordered X — confirm/cancel" message even
  // if Bosta rejects the shipment (bad address, missing images under new
  // Bosta rules, API outage, etc). The shipment can be fixed from the
  // admin after the fact, but the customer must never be left in the dark.
  // Persist the second phone first so the WhatsApp fallback has it.
  // ─────────────────────────────────────────────────────────────────────
  const sbPatch = (body) => fetch(
    `${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(body),
    }
  );
  if (secondPhone) {
    try { await sbPatch({ second_phone: secondPhone }); }
    catch (e) { console.warn('second_phone patch failed:', e.message); }
  }
  let waResult = { skipped: true, reason: 'wa not configured' };
  if (waConfigured()) {
    try {
      const rr = await sbFetch(`orders?id=eq.${encodeURIComponent(orderId)}&select=code,products`);
      const [row] = (await rr.json().catch(() => [])) || [];
      const orderForWa = {
        customer_name: customerName,
        products: row?.products || [],
        est_shipping: shippingCost,
        total,
        allow_open: !!allowOpen,
        ship_code: '',           // Filled in by the shipped template later
        phone,
        code: row?.code || orderId,
      };
      const sent = await sendConfirmTemplate(orderForWa);
      if (sent?.ok) {
        waResult = { sent: true, msgId: sent.msgId };
        await sbPatch({ wa_msg_id: sent.msgId, wa_sent_at: new Date().toISOString() })
          .catch(() => {});
      } else {
        console.error('bosta.js WA confirm failed:', JSON.stringify(sent?.error || sent));
        waResult = { sent: false, error: sent?.error || sent };
      }
    } catch (e) {
      console.error('bosta.js WA confirm exception:', e && e.message);
      waResult = { sent: false, exception: String(e && e.message || e) };
    }
  } else {
    console.warn('bosta.js: WA_TOKEN or WA_PHONE_NUMBER_ID not set — skipping WhatsApp send');
  }

  // ─────────────────────────────────────────────────────────────────────
  // STEP 2 — Create the Bosta shipment. If this fails, the WhatsApp message
  // has already gone out and the order sits in Processing with no ship_code
  // — the admin can retry Bosta from the dashboard. We still return a 200
  // because the customer-facing part (confirmation) succeeded.
  // ─────────────────────────────────────────────────────────────────────
  try {
    console.log('Bosta payload:', JSON.stringify(bostaPayload));

    const bostaRes = await fetch(`${BOSTA_BASE_URL}/deliveries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': BOSTA_API_KEY,  // No "Bearer" prefix — Bosta uses raw key
      },
      body: JSON.stringify(bostaPayload),
    });

    const bostaData = await bostaRes.json();

    // Log full response so we can spot any extra fields (real shipping fee, etc.)
    console.log('Bosta response:', JSON.stringify(bostaData));

    if (!bostaRes.ok) {
      console.error('Bosta error:', JSON.stringify(bostaData));
      // Non-fatal: WhatsApp confirmation already went out (STEP 1 above).
      // The admin fixes the Bosta payload (e.g. missing product images for
      // allowToOpenPackage, bad city) and retries from the dashboard.
      return res.status(200).json({ success: false, bostaError: bostaData, whatsapp: waResult });
    }

    const trackingNumber =
      bostaData?.trackingNumber ||
      bostaData?.data?.trackingNumber ||
      bostaData?.message?.trackingNumber ||
      null;

    const bostaId =
      bostaData?._id ||
      bostaData?.data?._id ||
      bostaData?.message?._id ||
      null;

    if (!trackingNumber) {
      console.error('No tracking number:', JSON.stringify(bostaData));
      return res.status(200).json({ success: false, bostaError: 'no tracking number', whatsapp: waResult });
    }

    // Save the Bosta ship code / id and the calculated shipping cost. All
    // best-effort: Bosta already accepted the shipment, so a Supabase hiccup
    // here just needs a retry later.
    try { await sbPatch({ ship_code: trackingNumber, bosta_id: bostaId, actual_shipping: 0 }); }
    catch (e) { console.warn('ship_code patch failed:', e.message); }
    try { await sbPatch({ calc_shipping: shippingCost }); }
    catch (e) { console.warn('calc_shipping patch failed:', e.message); }

    return res.status(200).json({ success: true, trackingNumber, shippingCost, whatsapp: waResult });

  } catch (e) {
    console.error('bosta.js exception:', e.message);
    return res.status(200).json({ success: false, error: e.message, whatsapp: waResult });
  }
}
