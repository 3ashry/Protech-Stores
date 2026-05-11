// protech-final/public/api/bosta.js
// Vercel Serverless Function — Create Bosta shipment after order is placed

const BOSTA_API_KEY = 'c52664c4064cdf74c0ffe71740215ab5199624add765ebcae3cd06f394cbac02'; // ⚠️ Regenerate before going live
const BOSTA_API_URL = 'https://app.bosta.co/api/v2/deliveries';

const SUPABASE_URL = 'https://wljxplbcfoorqpoflcdz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_zsHh-eOarHI7BSGtuP6WWQ_PQ4ACoHG';

// Full mapping: Arabic city name → Bosta city code
const CITY_MAP = {
  'القاهرة':    'EG-01',
  'الجيزة':    'EG-02',
  'الإسكندرية': 'EG-03',
  'الشرقية':   'EG-04',
  'الدقهلية':  'EG-05',
  'القليوبية': 'EG-06',
  'المنوفية':  'EG-07',
  'الغربية':   'EG-08',
  'كفر الشيخ': 'EG-09',
  'البحيرة':   'EG-10',
  'الإسماعيلية': 'EG-11',
  'السويس':    'EG-12',
  'بورسعيد':   'EG-13',
  'دمياط':     'EG-14',
  'سوهاج':     'EG-15',
  'أسيوط':     'EG-16',
  'المنيا':    'EG-17',
  'الفيوم':    'EG-18',
  'بني سويف':  'EG-19',
  'قنا':       'EG-20',
  'الأقصر':    'EG-21',
  'أسوان':     'EG-22',
};

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') return res.status(405).end();

  const { orderId, customerName, phone, city, address, notes, total } = req.body;

  // Validate required fields
  if (!orderId || !customerName || !phone || !city || !address || !total) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Map Arabic city name to Bosta city code
  const cityCode = CITY_MAP[city];
  if (!cityCode) {
    console.error(`Unknown city: ${city}`);
    return res.status(400).json({ error: `Unknown city: ${city}` });
  }

  // Split customer name into first/last (Bosta requires both)
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

  // Build Bosta shipment payload
  const bostaPayload = {
    type: 10,                         // 10 = Cash on Delivery
    cod: total,                       // Amount to collect from customer
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
    const bostaRes = await fetch(BOSTA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BOSTA_API_KEY}`,
      },
      body: JSON.stringify(bostaPayload),
    });

    const bostaData = await bostaRes.json();

    if (!bostaRes.ok) {
      console.error('Bosta API error:', bostaData);
      return res.status(502).json({ error: 'Bosta API error', details: bostaData });
    }

    // Extract tracking number and shipping cost from Bosta response
    const trackingNumber = bostaData?.trackingNumber || bostaData?.data?.trackingNumber || null;
    const shippingCost   = bostaData?.cod          || bostaData?.data?.deliveryFee     || 80;

    if (!trackingNumber) {
      console.error('No tracking number in Bosta response:', bostaData);
      return res.status(502).json({ error: 'No tracking number returned', details: bostaData });
    }

    // 2. Update Supabase order with ship_code + real shipping cost
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

    // Success — return tracking number to the store
    return res.status(200).json({ success: true, trackingNumber, shippingCost });

  } catch (e) {
    console.error('bosta.js exception:', e);
    return res.status(500).json({ error: e.message });
  }
}
