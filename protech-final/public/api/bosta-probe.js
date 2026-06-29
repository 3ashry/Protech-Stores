// protech-final/api/bosta-probe.js
// READ-ONLY calibration helper. Lists a few of the business's recent Bosta deliveries so we
// can see the exact shape (delivery _id, state value/code, and the shipping-fee field), then
// build the real sync. Does NOT write anything.
//   /api/bosta-probe            -> lists recent deliveries
//   /api/bosta-probe?id=<_id>   -> fetch one delivery by its Bosta _id
const BOSTA_API_KEY = process.env.BOSTA_API_KEY;
const BOSTA_BASE_URL = process.env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2';

async function tryFetch(url, opts = {}) {
  try {
    const r = await fetch(url, { headers: { 'Authorization': BOSTA_API_KEY, 'Content-Type': 'application/json' }, ...opts });
    const body = await r.json().catch(() => null);
    return { url, method: opts.method || 'GET', status: r.status, ok: r.ok, body };
  } catch (e) { return { url, error: e.message }; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!BOSTA_API_KEY) return res.status(500).json({ error: 'Server not configured (BOSTA_API_KEY missing)' });

  const id = (req.query.id || '').toString().trim();
  const results = {};

  if (id) {
    results.byId = await tryFetch(`${BOSTA_BASE_URL}/deliveries/business/${encodeURIComponent(id)}`);
  } else {
    // Try the common "list my deliveries" endpoints; one of these should return recent shipments.
    results.list_a = await tryFetch(`${BOSTA_BASE_URL}/deliveries/business?limit=3&pageNumber=1`);
    results.list_b = await tryFetch(`${BOSTA_BASE_URL}/deliveries?limit=3`);
    results.list_search = await tryFetch(`${BOSTA_BASE_URL}/deliveries/search`, { method: 'POST', body: JSON.stringify({ limit: 3 }) });
  }

  console.log('bosta-probe', JSON.stringify(results).slice(0, 4000));
  return res.status(200).json({ id: id || null, results });
}
