// protech-final/api/sync-status.js
// Pulls delivery states from Bosta and updates order statuses to match.
// - Matches Bosta deliveries to orders by businessReference (= our order id) or trackingNumber.
// - Auto-advances: Processing -> In Transit -> Delivered -> On its way to me, + Awaiting Action.
// - Never auto-sets Returned or Cancelled (you do those manually), and skips orders already
//   Returned/Cancelled or returned-to-stock.
// - Tries to read the actual shipping fee from Bosta's pricing if present (usually empty).
const BOSTA_API_KEY = process.env.BOSTA_API_KEY;
const BOSTA_BASE_URL = process.env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Map a Bosta state value -> our status (null = leave unchanged / handle manually).
function mapState(stateValue) {
  const v = (stateValue || '').toLowerCase();
  if (!v) return null;
  if (v.includes('deliver')) return 'Delivered';                         // Delivered
  if (v.includes('return')) return 'On its way to me';                   // any return = coming back
  if (v.includes('cancel') || v.includes('terminat')) return null;       // manual
  if (v.includes('exception') || v.includes('awaiting') || v.includes('on hold') || v.includes('action') || v.includes('issue')) return 'Awaiting Action';
  if (v.includes('transit') || v.includes('picked') || v.includes('out for delivery') || v.includes('received at') || v.includes('on its way') || v.includes('heading') || v.includes('dispatch')) return 'In Transit';
  if (v.includes('created') || v.includes('pending') || v.includes('pickup requested') || v.includes('awaiting pickup')) return 'Processing';
  return null; // unknown -> leave unchanged (logged below)
}

async function fetchAllDeliveries() {
  const all = [];
  for (let page = 1; page <= 15; page++) {
    const r = await fetch(`${BOSTA_BASE_URL}/deliveries/search`, {
      method: 'POST',
      headers: { 'Authorization': BOSTA_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 100, page, pageNumber: page }),
    });
    const d = await r.json().catch(() => null);
    const list = d?.data?.deliveries || [];
    all.push(...list);
    const count = d?.data?.count || 0;
    if (list.length < 100 || all.length >= count) break;
  }
  return all;
}

// Pull a shipping fee (number) out of a Bosta pricing object, trying the common fields.
function pickFee(pricing) {
  if (!pricing || typeof pricing !== 'object') return null;
  const cands = [
    pricing.priceAfterVat, pricing.total, pricing.businessAmount, pricing.priceBeforeVat,
    pricing.shippingFee, pricing.deliveryFee, pricing.cost, pricing.amount,
  ];
  for (const c of cands) { const n = parseFloat(c); if (!isNaN(n) && n > 0) return n; }
  return null;
}

// Get the actual shipping fee for a delivery. The list endpoint usually leaves pricing
// empty, so fall back to the individual delivery detail (richer). Returns a number or null.
async function fetchDeliveryFee(bostaId, searchObj, feeLog) {
  let fee = pickFee(searchObj && searchObj.pricing);
  if (fee) return fee;
  if (!bostaId) return null;
  try {
    const r = await fetch(`${BOSTA_BASE_URL}/deliveries/${encodeURIComponent(bostaId)}`, {
      headers: { Authorization: BOSTA_API_KEY },
    });
    const d = await r.json().catch(() => null);
    const del = (d && d.data) ? d.data : d;
    const pricing = del && del.pricing;
    if (feeLog && pricing) feeLog.push({ id: bostaId, pricing });
    return pickFee(pricing);
  } catch { return null; }
}

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  return r.json();
}
async function sbPatch(id, body) {
  return fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!BOSTA_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }
  try {
    const deliveries = await fetchAllDeliveries();
    const byRef = {}, byTrack = {};
    const unknownStates = new Set();
    for (const d of deliveries) {
      if (d.businessReference) byRef[d.businessReference] = d;
      if (d.trackingNumber) byTrack[d.trackingNumber] = d;
    }

    const orders = await sbGet('orders?select=id,code,ship_code,status,warehouse_confirmed,actual_shipping,bosta_id&limit=3000');
    const MANUAL = ['Returned', 'Cancelled'];
    const changes = [];
    const feeLog = [];
    for (const o of (orders || [])) {
      const d = byRef[o.id] || (o.ship_code && byTrack[o.ship_code]);
      if (!d) continue;
      const mapped = mapState(d.state?.value);
      const patch = {};

      // 1) Auto-advance status (never for manual Returned/Cancelled or already-restocked).
      if (!o.warehouse_confirmed && !MANUAL.includes(o.status)) {
        if (mapped && mapped !== o.status) patch.status = mapped;
        else if (!mapped && d.state?.value) unknownStates.add(d.state.value);
      }

      // 2) Readjust actual shipping from Bosta for delivered / returned orders (overwrite).
      const bostaState = (d.state?.value || '').toLowerCase();
      const effStatus = patch.status || o.status;
      const isDelOrRet = ['Delivered', 'Returned', 'On its way to me'].includes(effStatus)
        || /deliver|return/.test(bostaState);
      if (isDelOrRet) {
        const fee = await fetchDeliveryFee(o.bosta_id, d, feeLog);
        if (typeof fee === 'number' && fee > 0 && fee !== parseFloat(o.actual_shipping || 0)) {
          patch.actual_shipping = fee;
        }
      }

      if (Object.keys(patch).length) {
        await sbPatch(o.id, patch);
        changes.push({ code: o.code, from: o.status, bostaState: d.state?.value, ...patch });
      }
    }
    const result = { ok: true, bostaDeliveries: deliveries.length, ordersChecked: (orders || []).length, updated: changes.length, changes, unknownStates: [...unknownStates], feeSamples: feeLog.slice(0, 8) };
    console.log('sync-status', JSON.stringify(result));
    return res.status(200).json(result);
  } catch (e) {
    console.error('sync-status error', e.message);
    return res.status(500).json({ error: e.message });
  }
}
