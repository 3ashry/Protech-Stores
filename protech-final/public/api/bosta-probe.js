// protech-final/api/bosta-probe.js
// READ-ONLY: fetches Bosta's raw response for one tracking number so we can see the exact
// state values + shipping-fee fields, then build the real sync with a verified mapping.
// Usage:  /api/bosta-probe?code=<trackingNumber>
// Does NOT write to the database.
const BOSTA_API_KEY = process.env.BOSTA_API_KEY;
const BOSTA_BASE_URL = process.env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2';

async function tryFetch(url) {
  try {
    const r = await fetch(url, { headers: { 'Authorization': BOSTA_API_KEY, 'Content-Type': 'application/json' } });
    const body = await r.json().catch(() => null);
    return { url, status: r.status, ok: r.ok, body };
  } catch (e) { return { url, error: e.message }; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!BOSTA_API_KEY) return res.status(500).json({ error: 'Server not configured (BOSTA_API_KEY missing)' });
  const code = (req.query.code || '').toString().trim();
  if (!code) return res.status(400).json({ error: 'Pass ?code=<trackingNumber>' });

  // Try the likely endpoints; we only need to see which one returns the state + fees.
  const results = {};
  results.track = await tryFetch(`${BOSTA_BASE_URL}/deliveries/track/${encodeURIComponent(code)}`);
  results.businessByTracking = await tryFetch(`${BOSTA_BASE_URL}/deliveries/business/${encodeURIComponent(code)}`);
  results.search = await tryFetch(`${BOSTA_BASE_URL}/deliveries?search=${encodeURIComponent(code)}`);

  console.log('bosta-probe', code, JSON.stringify(results));
  return res.status(200).json({ code, results });
}
