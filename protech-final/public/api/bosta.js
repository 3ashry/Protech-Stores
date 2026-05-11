// protech-final/public/api/bosta.js
// Vercel Serverless Function — Create Bosta shipment after order is placed
// City codes verified from live Bosta API /cities response

const BOSTA_API_KEY = 'c52664c4064cdf74c0ffe71740215ab5199624add765ebcae3cd06f394cbac02'; // ⚠️ Regenerate before going live
const BOSTA_BASE_URL = 'https://app.bosta.co/api/v2';

const SUPABASE_URL = 'https://wljxplbcfoorqpoflcdz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_zsHh-eOarHI7BSGtuP6WWQ_PQ4ACoHG';

// Arabic city name → Bosta city code
// 100% verified from live Bosta /cities API response
// Both formal (alias) and informal (nameAr) spellings included
const CITY_MAP = {
  // Cairo — EG-01
  'القاهرة':      'EG-01',
  'القاهره':      'EG-01',

  // Alexandria — EG-02
  'الإسكندرية':  'EG-02',
  'الاسكندريه':  'EG-02',
  'الإسكندريه':  'EG-02',

  // North Coast — EG-03
  'الساحل الشمالي': 'EG-03',

  // Beheira — EG-04
  'البحيرة':     'EG-04',
  'البحيره':     'EG-04',

  // Dakahlia — EG-05
  'الدقهلية':    'EG-05',
  'الدقهليه':    'EG-05',

  // El Kalioubia — EG-06
  'القليوبية':   'EG-06',
  'القليوبيه':   'EG-06',

  // Gharbia — EG-07
  'الغربية':     'EG-07',
  'الغربيه':     'EG-07',

  // Kafr El Sheikh — EG-08
  'كفر الشيخ':   'EG-08',

  // Monufia — EG-09
  'المنوفية':    'EG-09',
  'المنوفيه':    'EG-09',

  // Sharqia — EG-10
  'الشرقية':     'EG-10',
  'الشرقيه':     'EG-10',

  // Ismailia — EG-11
  'الإسماعيلية': 'EG-11',
  'الاسماعيليه': 'EG-11',
  'الإسماعيليه': 'EG-11',

  // Suez — EG-12
  'السويس':      'EG-12',

  // Port Said — EG-13
  'بورسعيد':     'EG-13',
  'بور سعيد':    'EG-13',

  // Damietta — EG-14
  'دمياط':       'EG-14',

  // Fayoum — EG-15
  'الفيوم':      'EG-15',

  // Beni Suef — EG-16
  'بني سويف':    'EG-16',

  // Asyut — EG-17
  'أسيوط':       'EG-17',
  'اسيوط':       'EG-17',

  // Sohag — EG-18
  'سوهاج':       'EG-18',

  // Minya — EG-19
  'المنيا':      'EG-19',

  // Qena — EG-20
  'قنا':         'EG-20',

  // Aswan — EG-21
  'أسوان':       'EG-21',
  'اسوان':       'EG-21',

  // Luxor — EG-22
  'الأقصر':      'EG-22',
  'الاقصر':      'EG-22',

  // Red Sea — EG-23
  'البحر الأحمر': 'EG-23',
  'البحر الاحمر': 'EG-23',

  // New Valley — EG-24
  'الوادي الجديد': 'EG-24',

  // Giza — EG-25
  'الجيزة':      'EG-25',
  'الجيزه':      'EG-25',

  // South Sinai — EG-26
  'جنوب سيناء':  'EG-26',

  // North Sinai — EG-27
  'شمال سيناء':  'EG-27',

  // Matrouh — EG-28
  'مرسي مطروح':  'EG-28',
  'مطروح':       'EG-28',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { orderId, customerName, phone, city, address, notes, total } = req.body;

  // Validate required fields
  if (!orderId || !customerName || !phone || !city || !address || !total) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Resolve city code
  const cityCode = CITY_MAP[city];
  if (!cityCode) {
    console.error(`Unknown city: "${city}"`);
    return res.status(400).json({ error: `Unknown city: "${city}"` });
  }

  // Split name into first / last (Bosta requires both)
  const nameParts = customerName.trim().split(' ');
  const firstName = nameParts[0] || customerName;
  const lastName = nameParts.slice(1).join(' ') || '-';

  // Format phone to E.164 (+20XXXXXXXXXX)
  let formattedPhone = phone.trim().replace(/\s+/g, '');
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '+2' + formattedPhone;
  } else if (!formattedPhone.startsWith('+')) {
    formattedPhone = '+2' + formattedPhone;
  }

  // Bosta shipment payload
  const bostaPayload = {
    type: 10,       // 10 = Cash on Delivery
    cod: total,     // Amount to collect from customer (EGP)
    dropOffAddress: {
      cityCode,
      firstLine: address,
    },
    receiver: {
      firstName,
      lastName,
      phone: formattedPhone,
    },
    notes: notes || '',
  };

  try {
    // 1. Create shipment on Bosta
    const bostaRes = await fetch(`${BOSTA_BASE_URL}/deliveries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BOSTA_API_KEY}`,
      },
      body: JSON.stringify(bostaPayload),
    });

    const bostaData = await bostaRes.json();

    if (!bostaRes.ok) {
      console.error('Bosta create shipment error:', JSON.stringify(bostaData));
      return res.status(502).json({ error: 'Bosta API error', details: bostaData });
    }

    // Extract tracking number from response
    const trackingNumber =
      bostaData?.trackingNumber ||
      bostaData?.data?.trackingNumber ||
      bostaData?.message?.trackingNumber ||
      null;

    // Extract delivery fee — fall back to 80 EGP if not returned
    const shippingCost =
      bostaData?.deliveryFee ||
      bostaData?.data?.deliveryFee ||
      bostaData?.message?.deliveryFee ||
      80;

    if (!trackingNumber) {
      console.error('No tracking number in Bosta response:', JSON.stringify(bostaData));
      return res.status(502).json({ error: 'No tracking number returned', details: bostaData });
    }

    // 2. Update Supabase order: ship_code + real est_shipping
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
    console.error('bosta.js unhandled exception:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
