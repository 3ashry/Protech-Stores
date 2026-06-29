// protech-final/api/bosta.js
// Vercel Serverless Function — Create Bosta shipment after order is placed
//
// Secrets are read from environment variables (Vercel → Project → Settings →
// Environment Variables). Never hardcode keys here — this file is in source control.
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

  const { orderId, customerName, phone, city, address, notes, total, allowOpen } = req.body || {};

  if (!orderId || !customerName || !phone || !city || !address || !total) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // orderId is interpolated into a PostgREST filter URL below — only allow safe id chars.
  if (!/^[A-Za-z0-9_-]+$/.test(String(orderId))) {
    return res.status(400).json({ error: 'Invalid orderId' });
  }

  const cityCode = CITY_MAP[city];
  if (!cityCode) {
    console.error(`Unknown city: "${city}"`);
    return res.status(400).json({ error: `Unknown city: "${city}"` });
  }

  const nameParts = customerName.trim().split(' ');
  const firstName = nameParts[0] || customerName;
  const lastName = nameParts.slice(1).join(' ') || '-';

  let formattedPhone = phone.trim().replace(/\s+/g, '');
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '+2' + formattedPhone;
  } else if (!formattedPhone.startsWith('+')) {
    formattedPhone = '+2' + formattedPhone;
  }

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

  const bostaPayload = {
    type: 10,           // SEND with COD
    cod: total,         // Customer pays exactly this — same number shown at checkout
    specs: {
      packageType: 'Parcel',
      size: 'SMALL',
      packageDetails: {
        itemsCount: 1,
        description: 'أدوات',
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
    },
    businessReference: orderId,  // Links Bosta shipment back to our order
    notes: notes || '',
    allowToOpenPackage: !!allowOpen,  // Customer chose "open package before receiving"
  };

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
      return res.status(502).json({ error: 'Bosta API error', details: bostaData });
    }

    const trackingNumber =
      bostaData?.trackingNumber ||
      bostaData?.data?.trackingNumber ||
      bostaData?.message?.trackingNumber ||
      null;

    if (!trackingNumber) {
      console.error('No tracking number:', JSON.stringify(bostaData));
      return res.status(502).json({ error: 'No tracking number returned', details: bostaData });
    }

    const updateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          ship_code: trackingNumber,
          // Bosta's real cost goes to actual_shipping (the merchant's expense, used by
          // the financials). Do NOT overwrite est_shipping — that holds the reduced
          // amount the customer was actually charged (storefront already subtracts 40).
          actual_shipping: shippingCost,
        }),
      }
    );

    if (!updateRes.ok) {
      const err = await updateRes.text();
      console.error('Supabase update error:', err);
      return res.status(502).json({ error: 'Supabase update failed', details: err });
    }

    return res.status(200).json({ success: true, trackingNumber, shippingCost });

  } catch (e) {
    console.error('bosta.js exception:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
