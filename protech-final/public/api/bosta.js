// protech-final/public/api/bosta.js
// Vercel Serverless Function — Create Bosta shipment after order is placed
// City codes are fetched LIVE from Bosta API — no hardcoded mapping needed

const BOSTA_API_KEY = 'c52664c4064cdf74c0ffe71740215ab5199624add765ebcae3cd06f394cbac02'; // ⚠️ Regenerate before going live
const BOSTA_BASE_URL = 'https://app.bosta.co/api/v2';

const SUPABASE_URL = 'https://wljxplbcfoorqpoflcdz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_zsHh-eOarHI7BSGtuP6WWQ_PQ4ACoHG';

// Arabic city name → possible English name variants Bosta might use
// We match flexibly against whatever Bosta returns from their /cities endpoint
const ARABIC_TO_ENGLISH = {
  'القاهرة':      ['cairo', 'al qahirah', 'al-qahirah'],
  'الجيزة':      ['giza', 'al jizah', 'al-jizah', 'al giza'],
  'الإسكندرية':  ['alexandria', 'al iskandariyah', 'al-iskandariyah'],
  'الشرقية':     ['sharqia', 'ash sharqiyah', 'al sharqia', 'sharqiyah'],
  'الدقهلية':    ['dakahlia', 'ad daqahliyah', 'daqahliyah'],
  'القليوبية':   ['qalyubia', 'al qalyubiyah', 'qalyubiyah'],
  'المنوفية':    ['monufia', 'al minufiyah', 'minufiyah', 'menufia'],
  'الغربية':     ['gharbia', 'al gharbiyah', 'gharbiyah'],
  'كفر الشيخ':   ['kafr el sheikh', 'kafr ash shaykh', 'kafr el-sheikh'],
  'البحيرة':     ['beheira', 'al buhayrah', 'buhayrah', 'buhaira'],
  'الإسماعيلية': ['ismailia', 'al ismailiyah', 'ismailiyah'],
  'السويس':      ['suez', 'as suways', 'al suways'],
  'بورسعيد':     ['port said', 'bur said', 'bur saeid'],
  'دمياط':       ['damietta', 'dumyat', 'damiata'],
  'سوهاج':       ['sohag', 'suhaj', 'souhag'],
  'أسيوط':       ['asyut', 'assiut', 'assiout', 'asyout'],
  'المنيا':      ['minya', 'al minya', 'el minya'],
  'الفيوم':      ['faiyum', 'fayoum', 'al fayyum', 'el fayoum'],
  'بني سويف':    ['beni suef', 'bani suwayf', 'beni sueif'],
  'قنا':         ['qena', 'qina', 'kena'],
  'الأقصر':      ['luxor', 'al uqsur', 'al-uqsur'],
  'أسوان':       ['aswan', 'asuan'],
};

async function getCityCode(arabicCityName) {
  // Fetch live city list from Bosta
  const res = await fetch(`${BOSTA_BASE_URL}/cities`, {
    headers: {
      'Authorization': `Bearer ${BOSTA_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Bosta cities endpoint failed: ${res.status}`);
  }

  const data = await res.json();

  // Bosta may wrap results — handle both array and object responses
  const cities = Array.isArray(data) ? data : (data.data || data.cities || []);

  if (!cities.length) {
    throw new Error('Bosta returned an empty cities list');
  }

  // Get English variants for this Arabic city name
  const variants = ARABIC_TO_ENGLISH[arabicCityName];
  if (!variants) {
    throw new Error(`No English mapping found for Arabic city: "${arabicCityName}"`);
  }

  // Match Bosta city by name (case-insensitive, flexible)
  const match = cities.find(city => {
    const bostaName = (city.name || city.nameEn || city.cityName || '').toLowerCase().trim();
    return variants.some(v => bostaName.includes(v) || v.includes(bostaName));
  });

  if (!match) {
    // Log all names from Bosta to help debug mismatches
    const allNames = cities
      .map(c => c.name || c.nameEn || c.cityName || JSON.stringify(c))
      .join(', ');
    throw new Error(`Could not match "${arabicCityName}" in Bosta cities list. Available: ${allNames}`);
  }

  // Return whichever field Bosta uses as the city identifier
  const code = match._id || match.id || match.code || match.cityCode;
  if (!code) {
    throw new Error(`Matched city "${arabicCityName}" but could not find its code in: ${JSON.stringify(match)}`);
  }

  return code;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { orderId, customerName, phone, city, address, notes, total } = req.body;

  // Validate required fields
  if (!orderId || !customerName || !phone || !city || !address || !total) {
    return res.status(400).json({ error: 'Missing required fields' });
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

  // Resolve city code live from Bosta
  let cityCode;
  try {
    cityCode = await getCityCode(city);
  } catch (e) {
    console.error('City lookup failed:', e.message);
    return res.status(400).json({ error: 'City lookup failed', details: e.message });
  }

  // Build Bosta shipment payload
  const bostaPayload = {
    type: 10,     // 10 = Cash on Delivery
    cod: total,   // Amount to collect from customer
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
      console.error('Bosta create shipment error:', bostaData);
      return res.status(502).json({ error: 'Bosta API error', details: bostaData });
    }

    // Extract tracking number — try common response shapes
    const trackingNumber =
      bostaData?.trackingNumber ||
      bostaData?.data?.trackingNumber ||
      bostaData?.message?.trackingNumber ||
      null;

    // Extract shipping fee — fall back to 80 EGP if not returned
    const shippingCost =
      bostaData?.deliveryFee ||
      bostaData?.data?.deliveryFee ||
      bostaData?.message?.deliveryFee ||
      80;

    if (!trackingNumber) {
      console.error('No tracking number in Bosta response:', bostaData);
      return res.status(502).json({ error: 'No tracking number returned', details: bostaData });
    }

    // 2. Update Supabase order: set ship_code and real est_shipping
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
    console.error('bosta.js unhandled exception:', e);
    return res.status(500).json({ error: e.message });
  }
}
