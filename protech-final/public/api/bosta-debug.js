// protech-final/public/api/bosta-debug.js
// One-off diagnostic: fetch a single delivery from Bosta by tracking number
// and return the raw response so we can see WHERE the actual fee lives.
// Usage: /api/bosta-debug?track=7813516714
// Delete this file (or leave it, it only reads) after we've fixed pickFee.
const BOSTA_API_KEY = process.env.BOSTA_API_KEY;
const BOSTA_BASE_URL = process.env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!BOSTA_API_KEY) return res.status(500).json({ error: 'BOSTA_API_KEY not set' });
  const track = (req.query?.track || '').toString().trim();
  if (!track) return res.status(400).json({ error: 'pass ?track=<tracking number>' });

  try {
    // 1) Find the delivery via search (this is what sync-status uses to enumerate).
    const searchRes = await fetch(`${BOSTA_BASE_URL}/deliveries/search`, {
      method: 'POST',
      headers: { Authorization: BOSTA_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackingNumber: track, limit: 5, page: 1 }),
    });
    const searchJson = await searchRes.json().catch(() => null);
    const searchHit = (searchJson?.data?.deliveries || []).find(d => d.trackingNumber === track)
      || searchJson?.data?.deliveries?.[0] || null;
    const bostaId = searchHit?._id;

    // 2) Also hit the detail endpoint (usually has pricing that search omits).
    let detail = null;
    if (bostaId) {
      const dr = await fetch(`${BOSTA_BASE_URL}/deliveries/business/${encodeURIComponent(bostaId)}`, {
        headers: { Authorization: BOSTA_API_KEY },
      });
      detail = await dr.json().catch(() => null);
    }

    // 3) Return EVERY top-level key + the pricing object from both, so we can
    //    spot which field holds the real 127 EGP fee.
    return res.status(200).json({
      track,
      bostaId,
      searchHit_topLevelKeys: searchHit ? Object.keys(searchHit) : null,
      searchHit_pricing: searchHit?.pricing || null,
      searchHit_state: searchHit?.state || null,
      detail_topLevelKeys: detail?.data ? Object.keys(detail.data) : (detail ? Object.keys(detail) : null),
      detail_pricing: (detail?.data?.pricing || detail?.pricing) || null,
      detail_fullResponse: detail,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
