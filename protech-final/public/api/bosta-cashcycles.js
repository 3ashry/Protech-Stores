// protech-final/public/api/bosta-cashcycles.js
// Scans recent Bosta deliveries and reports which have a closed cash cycle
// (definitive invoice available) vs null (Bosta hasn't invoiced yet).
// Usage: /api/bosta-cashcycles           → last 200 deliveries, all states
//        /api/bosta-cashcycles?state=Delivered  → filter by state
//        /api/bosta-cashcycles?pages=5   → number of 100-row pages to scan
const BOSTA_API_KEY = process.env.BOSTA_API_KEY;
const BOSTA_BASE_URL = process.env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2';

async function searchPage(page) {
  const r = await fetch(`${BOSTA_BASE_URL}/deliveries/search`, {
    method: 'POST',
    headers: { Authorization: BOSTA_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 100, page, pageNumber: page }),
  });
  const d = await r.json().catch(() => null);
  return d?.data?.deliveries || [];
}

async function fetchDetail(bostaId) {
  try {
    const r = await fetch(`${BOSTA_BASE_URL}/deliveries/business/${encodeURIComponent(bostaId)}`, {
      headers: { Authorization: BOSTA_API_KEY },
    });
    const d = await r.json().catch(() => null);
    return d?.data || d;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!BOSTA_API_KEY) return res.status(500).json({ error: 'BOSTA_API_KEY not set' });

  const stateFilter = (req.query?.state || '').toString().trim();
  const pages = Math.min(10, Math.max(1, parseInt(req.query?.pages || '2') || 2));

  try {
    // 1) Collect deliveries from search (fast, no per-order fetch needed here).
    const all = [];
    for (let p = 1; p <= pages; p++) {
      const list = await searchPage(p);
      all.push(...list);
      if (list.length < 100) break;
    }

    // 2) Filter by state if requested.
    const filtered = stateFilter
      ? all.filter(d => (d?.state?.value || '') === stateFilter)
      : all;

    // 3) For each, hit the detail endpoint to see if wallet.cashCycle is populated.
    //    Do them in small parallel batches so we don't hammer Bosta.
    const results = [];
    const batchSize = 6;
    for (let i = 0; i < filtered.length; i += batchSize) {
      const batch = filtered.slice(i, i + batchSize);
      const details = await Promise.all(batch.map(d => fetchDetail(d._id)));
      details.forEach((det, idx) => {
        const src = batch[idx];
        const cc = det?.wallet?.cashCycle;
        results.push({
          track: src.trackingNumber,
          state: src?.state?.value,
          cod: src?.cod,
          cashCycleClosed: !!cc,
          bosta_fees: cc?.bosta_fees ?? null,
          shipmentFees_pre_vat: det?.shipmentFees ?? null,
          size: cc?.size || det?.specs?.packageType || null,
        });
      });
    }

    const closed = results.filter(r => r.cashCycleClosed);
    const open = results.filter(r => !r.cashCycleClosed);

    return res.status(200).json({
      scanned: results.length,
      stateFilter: stateFilter || '(any)',
      pages,
      summary: {
        closedCashCycles: closed.length,
        openCashCycles: open.length,
        totalInvoicedSoFar: closed.reduce((s, r) => s + (parseFloat(r.bosta_fees) || 0), 0).toFixed(2),
      },
      closed: closed.map(r => ({ track: r.track, state: r.state, cod: r.cod, bosta_fees: r.bosta_fees, size: r.size })),
      openList: open.map(r => ({ track: r.track, state: r.state, cod: r.cod, shipmentFees_pre_vat: r.shipmentFees_pre_vat, size: r.size })),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
