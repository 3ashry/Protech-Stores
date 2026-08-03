// protech-final/public/api/bosta-debug.js
// Diagnostic: fetch a specific delivery from Bosta by tracking number.
// Usage: /api/bosta-debug?track=7813516714
const BOSTA_API_KEY = process.env.BOSTA_API_KEY;
const BOSTA_BASE_URL = process.env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2';

// Paginate through the search endpoint until we find the exact tracking match.
async function findByTracking(track) {
  for (let page = 1; page <= 15; page++) {
    const r = await fetch(`${BOSTA_BASE_URL}/deliveries/search`, {
      method: 'POST',
      headers: { Authorization: BOSTA_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 100, page, pageNumber: page }),
    });
    const d = await r.json().catch(() => null);
    const list = d?.data?.deliveries || [];
    const hit = list.find(x => x.trackingNumber === track);
    if (hit) return hit;
    if (list.length < 100) break;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!BOSTA_API_KEY) return res.status(500).json({ error: 'BOSTA_API_KEY not set' });
  const track = (req.query?.track || '').toString().trim();
  if (!track) return res.status(400).json({ error: 'pass ?track=<tracking number>' });

  try {
    const searchHit = await findByTracking(track);
    if (!searchHit) return res.status(404).json({ error: `No delivery found for tracking ${track}` });
    const bostaId = searchHit._id;

    // Detail endpoint (this is where `shipmentFees` lives).
    const dr = await fetch(`${BOSTA_BASE_URL}/deliveries/business/${encodeURIComponent(bostaId)}`, {
      headers: { Authorization: BOSTA_API_KEY },
    });
    const detail = await dr.json().catch(() => null);
    const del = detail?.data || detail;

    // Compute what our current sync would produce.
    const shipmentFees = parseFloat(del?.shipmentFees);
    const computedActual = !isNaN(shipmentFees) && shipmentFees > 0
      ? Math.round(shipmentFees * 1.14)
      : null;

    // Also try the /pricing endpoint (some Bosta APIs expose invoice-level fees there).
    let pricingDetail = null;
    try {
      const pr = await fetch(`${BOSTA_BASE_URL}/deliveries/${encodeURIComponent(bostaId)}/pricing`, {
        headers: { Authorization: BOSTA_API_KEY },
      });
      pricingDetail = await pr.json().catch(() => null);
    } catch {}

    // Also try the invoices/wallet endpoint for the actual charged amount.
    let walletDetail = null;
    try {
      const wr = await fetch(`${BOSTA_BASE_URL}/deliveries/business/${encodeURIComponent(bostaId)}/wallet`, {
        headers: { Authorization: BOSTA_API_KEY },
      });
      walletDetail = await wr.json().catch(() => null);
    } catch {}

    return res.status(200).json({
      track,
      matchedTracking: searchHit.trackingNumber,
      bostaId,
      state: del?.state?.value || searchHit?.state?.value,
      cod: del?.cod ?? searchHit?.cod,
      city: del?.dropOffAddress?.city?.nameAr || del?.dropOffAddress?.city?.name,
      shipmentFees_raw: del?.shipmentFees,
      pricing: del?.pricing || null,
      computedActualShipping_withVat: computedActual,
      note: 'computedActualShipping_withVat = shipmentFees × 1.14 (what our sync writes).',
      // Full raw payloads so we can grep for the true 127 EGP fee.
      fullDetail: del,
      pricingDetail,
      walletDetail,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
