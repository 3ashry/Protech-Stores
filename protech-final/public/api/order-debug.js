// protech-final/public/api/order-debug.js
// Diagnostic for a specific order by code: shows our DB row + Bosta's state
// + what mapState would produce, so we can see WHY the sync isn't flipping
// it to the expected status.
// Usage: /api/order-debug?code=ORD-XOFDO
const BOSTA_API_KEY = process.env.BOSTA_API_KEY;
const BOSTA_BASE_URL = process.env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

function extractCOD(d) {
  const cands = [
    d?.cod, d?.codAmount, d?.paymentAmount,
    d?.pricing?.cod, d?.pricing?.codAmount, d?.pricing?.cashOnDelivery,
  ];
  for (const c of cands) {
    if (c == null) continue;
    const n = parseFloat(typeof c === 'object' ? (c.amount ?? c.value) : c);
    if (!isNaN(n)) return n;
  }
  return null;
}

// Mirror the mapState logic from sync-status.js so we can preview what
// the sync WOULD assign to this order.
function mapState(d) {
  const v = (d?.state?.value || '').toLowerCase();
  if (!v) return null;
  const code = d?.state?.code;
  if (code === 46) return 'Returned';
  if (v === 'returned' || v.startsWith('returned') || v.includes('returned to')) return 'Returned';
  if (v.includes('deliver')) {
    if (v.includes('warehouse') || v.includes('business') || v.includes('merchant')
        || v.includes('sender') || v.includes('back to')) return 'Returned';
    return 'Delivered';
  }
  if (v.includes('cancel') || v.includes('terminat') || v.includes('rejected')) return 'Cancelled';
  if (v.includes('exception') || v.includes('awaiting your action')
      || v.includes('awaiting action') || v.includes('on hold')
      || v.includes('action required') || v.includes('issue')) return 'Awaiting Action';
  const cod = extractCOD(d);
  const attempts = parseInt(d?.deliveryAttemptsLength || d?.attemptsCount || 0) || 0;
  const alreadyTriedAndFailed = attempts > 0;
  const headingToCustomer = v.includes('heading') || v.includes('out for delivery')
      || v.includes('on its way to') || code === 41;
  const inTransitLike = v.includes('transit') || v.includes('progress')
      || v.includes('picked') || v.includes('warehouse')
      || v.includes('dispatch') || headingToCustomer;
  if (v.includes('return') || v.includes('back to')) return 'On its way to me';
  if (inTransitLike && (cod === 0 || alreadyTriedAndFailed)) return 'On its way to me';
  if (headingToCustomer) return 'Heading to Customer';
  if (inTransitLike) return 'In Transit';
  if (v.includes('created') || v.includes('pending') || v === 'new'
      || v.includes('pickup requested') || v.includes('awaiting pickup')
      || v.includes('ready to')) return 'Processing';
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const code = (req.query?.code || '').toString().trim();
  if (!code) return res.status(400).json({ error: 'pass ?code=<order code>' });
  if (!SUPABASE_URL || !SUPABASE_KEY || !BOSTA_API_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }
  try {
    // 1) Load our DB row.
    const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?select=*&code=eq.${encodeURIComponent(code)}&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const rows = await r.json().catch(() => []);
    const dbRow = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!dbRow) return res.status(404).json({ error: `No order with code ${code} in DB` });

    // 2) Fetch Bosta detail if we know the id/tracking.
    let bostaDetail = null;
    if (dbRow.bosta_id) {
      const br = await fetch(`${BOSTA_BASE_URL}/deliveries/business/${encodeURIComponent(dbRow.bosta_id)}`, {
        headers: { Authorization: BOSTA_API_KEY },
      });
      const bd = await br.json().catch(() => null);
      bostaDetail = bd?.data || bd;
    }

    const bostaState = bostaDetail?.state?.value;
    const bostaCode = bostaDetail?.state?.code;
    const cod = extractCOD(bostaDetail);
    const attempts = parseInt(bostaDetail?.deliveryAttemptsLength || bostaDetail?.attemptsCount || 0) || 0;
    const collected = parseFloat(bostaDetail?.cod_collectedAmount);
    const mapped = bostaDetail ? mapState(bostaDetail) : null;
    const wouldChange = mapped && mapped !== dbRow.status;

    return res.status(200).json({
      code,
      db: {
        status: dbRow.status,
        cash_cycle_closed: dbRow.cash_cycle_closed,
        actual_shipping: dbRow.actual_shipping,
        warehouse_confirmed: dbRow.warehouse_confirmed,
        bosta_id: dbRow.bosta_id,
        ship_code: dbRow.ship_code,
        customer_name: dbRow.customer_name,
        total: dbRow.total,
      },
      bosta: bostaDetail ? {
        state_value: bostaState,
        state_code: bostaCode,
        cod,
        cod_collectedAmount: collected,
        deliveryAttemptsLength: attempts,
        wallet_cashCycle: bostaDetail?.wallet?.cashCycle || null,
      } : { error: 'No bosta_id on DB row → cannot fetch detail' },
      diagnosis: {
        bostaMappedStatus: mapped,
        currentDbStatus: dbRow.status,
        wouldSyncChangeIt: wouldChange,
        note: wouldChange
          ? `Next sync should flip status from "${dbRow.status}" to "${mapped}".`
          : (mapped ? `Sync would leave it as "${dbRow.status}" (matches Bosta).` : 'Bosta state did not map to any known status.'),
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
