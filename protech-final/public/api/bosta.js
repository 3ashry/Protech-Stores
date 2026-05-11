// protech-final/public/api/bosta.js
// Vercel Serverless Function — Create Bosta shipment after order is placed

const BOSTA_API_KEY = 'f53060d7b770cde18e78d50d910bb710798f1db40916714b3f77039f23973631';
const BOSTA_BASE_URL = 'https://app.bosta.co/api/v2';

const SUPABASE_URL = 'https://wljxplbcfoorqpoflcdz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_zsHh-eOarHI7BSGtuP6WWQ_PQ4ACoHG';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).end();

  const { orderId, customerName, phone, city, address, notes, total } = req.body;

  if (!orderId || !customerName || !phone || !city || !address || !total) {
    return res.status(400).json({ error: 'Missing required fields' });
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

  const bostaPayload = {
    type: 10,           // SEND with COD
    cod: total,         // Cash to collect on delivery
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
      firstLine: address,
    },
    receiver: {
      firstName,
      lastName,
      phone: formattedPhone,
    },
    businessReference: orderId,  // Links Bosta shipment back to our order
    notes: notes || '',
  };

  try {
    const bostaRes = await fetch(`${BOSTA_BASE_URL}/deliveries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': BOSTA_API_KEY,  // No "Bearer" prefix — Bosta uses raw key
      },
      body: JSON.stringify(bostaPayload),
    });

    const bostaData = await bostaRes.json();

    if (!bostaRes.ok) {
      console.error('Bosta error:', JSON.stringify(bostaData));
      return res.status(502).json({ error: 'Bosta API error', details: bostaData });
    }

    const trackingNumber =
      bostaData?.trackingNumber ||
      bostaData?.data?.trackingNumber ||
      bostaData?.message?.trackingNumber ||
      null;

    const shippingCost =
      bostaData?.deliveryFee ||
      bostaData?.data?.deliveryFee ||
      bostaData?.message?.deliveryFee ||
      80;

    if (!trackingNumber) {
      console.error('No tracking number:', JSON.stringify(bostaData));
      return res.status(502).json({ error: 'No tracking number returned', details: bostaData });
    }

    const updateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`,
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
          est_shipping: shippingCost,
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
