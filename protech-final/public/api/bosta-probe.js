// protech-final/api/bosta-probe.js
// READ-ONLY calibration helper to find where Bosta returns the ACTUAL shipping fee.
// Usage:
//   /api/bosta-probe?track=<trackingNumber>  -> full raw detail for one delivered order
//   /api/bosta-probe?id=<bosta _id>          -> full raw detail by Bosta id
//   /api/bosta-probe                         -> a few recent deliveries
// Does NOT write anything.
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

  const track = (req.query.track || '').toString().trim();
  const id = (req.query.id || '').toString().trim();
  const results = {};

  if (track) {
    // Find the delivery by tracking number, then pull its full detail (where the fee should be).
    const search = await tryFetch(`${BOSTA_BASE_URL}/deliveries/search`, {
      method: 'POST', body: JSON.stringify({ limit: 10, trackingNumbers: [track] }),
    });
    results.search = search;
    const list = search?.body?.data?.deliveries || [];
    const del = list.find(x => x.trackingNumber === track) || list[0];
    if (del?._id) results.detail = await tryFetch(`${BOSTA_BASE_URL}/deliveries/business/${encodeURIComponent(del._id)}`);
  } else if (id) {
    results.detail = await tryFetch(`${BOSTA_BASE_URL}/deliveries/business/${encodeURIComponent(id)}`);
  } else {
    results.recent = await tryFetch(`${BOSTA_BASE_URL}/deliveries/search`, { method: 'POST', body: JSON.stringify({ limit: 3 }) });
  }

  console.log('bosta-probe', JSON.stringify(results).slice(0, 6000));
  return res.status(200).json({ track: track || null, id: id || null, results });
}
