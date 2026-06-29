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
      body: JSON.stringify({ limit: 100, page }),
    });
    const d = await r.json().catch(() => null);
    const list = d?.data?.deliveries || [];
    all.push(...list);
    const count = d?.data?.count || 0;
    if (!list.length || all.length >= count) break;
  }
  return all;
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

    const orders = await sbGet('orders?select=id,code,ship_code,status,warehouse_confirmed,actual_shipping&limit=3000');
    const MANUAL = ['Returned', 'Cancelled'];
    const changes = [];
    for (const o of (orders || [])) {
      if (o.warehouse_confirmed) continue;
      if (MANUAL.includes(o.status)) continue;
      const d = byRef[o.id] || (o.ship_code && byTrack[o.ship_code]);
      if (!d) continue;
      const mapped = mapState(d.state?.value);
      if (!mapped) { if (d.state?.value) unknownStates.add(d.state.value); continue; }
      if (mapped === o.status) continue;
      const patch = { status: mapped };
      // Defensive: if Bosta ever exposes the fee, capture it on delivery.
      const fee = d.pricing?.priceAfterVat ?? d.pricing?.total ?? d.pricing?.businessAmount ?? null;
      if (mapped === 'Delivered' && typeof fee === 'number' && fee > 0 && !o.actual_shipping) patch.actual_shipping = fee;
      await sbPatch(o.id, patch);
      changes.push({ code: o.code, from: o.status, to: mapped, bostaState: d.state?.value });
    }
    const result = { ok: true, bostaDeliveries: deliveries.length, ordersChecked: (orders || []).length, updated: changes.length, changes, unknownStates: [...unknownStates] };
    console.log('sync-status', JSON.stringify(result));
    return res.status(200).json(result);
  } catch (e) {
    console.error('sync-status error', e.message);
    return res.status(500).json({ error: e.message });
  }
}
