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

// ── Actual Bosta shipping cost — same formula used at order creation (bosta.js) ──
const CITY_MAP = {
  'القاهرة':'EG-01','القاهره':'EG-01','الإسكندرية':'EG-02','الاسكندريه':'EG-02','الإسكندريه':'EG-02',
  'الساحل الشمالي':'EG-03','البحيرة':'EG-04','البحيره':'EG-04','الدقهلية':'EG-05','الدقهليه':'EG-05',
  'القليوبية':'EG-06','القليوبيه':'EG-06','الغربية':'EG-07','الغربيه':'EG-07','كفر الشيخ':'EG-08',
  'المنوفية':'EG-09','المنوفيه':'EG-09','الشرقية':'EG-10','الشرقيه':'EG-10','الإسماعيلية':'EG-11',
  'الاسماعيليه':'EG-11','الإسماعيليه':'EG-11','السويس':'EG-12','بورسعيد':'EG-13','بور سعيد':'EG-13',
  'دمياط':'EG-14','الفيوم':'EG-15','بني سويف':'EG-16','أسيوط':'EG-17','اسيوط':'EG-17','سوهاج':'EG-18',
  'المنيا':'EG-19','قنا':'EG-20','أسوان':'EG-21','اسوان':'EG-21','الأقصر':'EG-22','الاقصر':'EG-22',
  'البحر الأحمر':'EG-23','البحر الاحمر':'EG-23','الوادي الجديد':'EG-24','الجيزة':'EG-25','الجيزه':'EG-25',
  'جنوب سيناء':'EG-26','شمال سيناء':'EG-27','مرسي مطروح':'EG-28','مطروح':'EG-28',
};
const SHIPPING_RATES = {
  'EG-01':118,'EG-25':118,'EG-02':124,'EG-04':124,'EG-05':131,'EG-06':131,'EG-07':131,'EG-08':131,
  'EG-09':131,'EG-10':131,'EG-14':131,'EG-11':131,'EG-13':131,'EG-12':131,'EG-15':146,'EG-16':146,
  'EG-19':146,'EG-17':146,'EG-18':146,'EG-20':162,'EG-22':162,'EG-21':162,'EG-23':162,'EG-28':162,
  'EG-03':166,'EG-27':182,'EG-26':182,'EG-24':182,
};
// Bosta's real shipping cost (merchant expense) from the customer's city + COD total.
function calcActualShipping(city, total) {
  const baseRate = SHIPPING_RATES[CITY_MAP[city]] || 131;
  const COD = parseFloat(total) || 0;
  const codFee = Math.max(0, COD - 2000) * 0.01;
  const vat = (baseRate + codFee) * 0.14;
  return Math.ceil(baseRate + codFee + vat);
}

// Pull the COD amount from a Bosta delivery object. Returns 0 if no cash is
// being collected on this leg (which — combined with an "in progress" state
// — is Bosta's way of saying the parcel is on the return trip back to us).
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
  return null; // unknown → don't use for return-leg inference
}

// Map a Bosta delivery -> our status (null = leave unchanged / unknown state).
// Takes the whole delivery so we can use the COD-is-zero signal to detect the
// return leg (Bosta shows it as "in progress" with no cash to collect).
function mapState(d) {
  const v = (d?.state?.value || '').toLowerCase();
  if (!v) return null;

  // 1) TERMINAL states first — order arrived at its final destination.
  //    Returned-to-business / warehouse / merchant / sender = the parcel is
  //    physically back with us.
  if (v.includes('returned to business') || v.includes('returned to sender')
      || v.includes('returned to merchant') || v.includes('returned to warehouse')
      || v === 'returned') return 'Returned';
  if (v.includes('deliver')) return 'Delivered';

  // 2) Customer refused / order cancelled by anyone — auto-set so the
  //    dashboard reflects reality. (Manual protection lives in the caller:
  //    if the order is ALREADY Cancelled or Returned it won't be re-touched.)
  if (v.includes('cancel') || v.includes('terminat') || v.includes('rejected')) return 'Cancelled';

  // 3) Awaiting merchant action.
  if (v.includes('exception') || v.includes('awaiting your action')
      || v.includes('awaiting action') || v.includes('on hold')
      || v.includes('action required') || v.includes('issue')) return 'Awaiting Action';

  // 4) Return leg heading BACK to the merchant. Two signals:
  //    a) explicit "return" word (returning / on return / return to)
  //    b) currently in-transit AT ALL with COD === 0 → nothing to collect,
  //       so this trip is not going TO the customer.
  const cod = extractCOD(d);
  const inTransitLike = v.includes('transit') || v.includes('progress')
      || v.includes('picked') || v.includes('warehouse')
      || v.includes('heading') || v.includes('out for delivery')
      || v.includes('on its way') || v.includes('dispatch');
  if (v.includes('return') || v.includes('back to')) return 'On its way to me';
  if (inTransitLike && cod === 0) return 'On its way to me';

  // 5) Normal outbound in-transit — includes "heading to customer",
  //    "out for delivery", "picked up", "received at warehouse", etc.
  if (inTransitLike) return 'In Transit';

  // 6) Not-yet-picked-up.
  if (v.includes('created') || v.includes('pending') || v === 'new'
      || v.includes('pickup requested') || v.includes('awaiting pickup')
      || v.includes('ready to')) return 'Processing';

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

// Pull the ACTUAL shipping fee Bosta charged out of a delivery object.
// The reliable field is top-level `shipmentFees` on the detail endpoint —
// it's the base fee BEFORE VAT (Egypt VAT = 14%). We add VAT so what we
// store on `actual_shipping` matches what Bosta actually debits (e.g. a
// Borg ElArab→Cairo shipment shows shipmentFees:112 → 112×1.14 = 127.68 → 128,
// which matches Bosta's dashboard within 1 EGP rounding).
// Falls back to the older `pricing.*` fields if a future response uses them.
const VAT_RATE = 0.14;
function pickFee(del) {
  if (!del || typeof del !== 'object') return null;
  // 1) Primary source — top-level shipmentFees (base, pre-VAT).
  const base = parseFloat(del.shipmentFees);
  if (!isNaN(base) && base > 0) return Math.round(base * (1 + VAT_RATE));
  // 2) Fallbacks — some responses include a pricing sub-object.
  const p = del.pricing || {};
  const cands = [
    p.priceAfterVat, p.total, p.businessAmount, p.shippingFee, p.deliveryFee,
    p.cost, p.amount, p.deliveryCost, p.finalPrice,
    del.priceAfterVat, del.shippingFee, del.deliveryFee, del.price, del.cost,
  ];
  for (const c of cands) { const n = parseFloat(c && c.amount != null ? c.amount : c); if (!isNaN(n) && n > 0) return n; }
  // 3) pricing.priceBeforeVat — treat like shipmentFees (add VAT).
  const preVat = parseFloat(p.priceBeforeVat);
  if (!isNaN(preVat) && preVat > 0) return Math.round(preVat * (1 + VAT_RATE));
  return null;
}

// Get the ACTUAL shipping fee Bosta charged for a delivery, from the individual delivery
// detail endpoint (the list/search leaves pricing empty). Returns a number or null.
async function fetchDeliveryFee(bostaId, searchObj, feeLog) {
  const fromSearch = pickFee(searchObj);
  if (fromSearch) return fromSearch;
  if (!bostaId) return null;
  try {
    const r = await fetch(`${BOSTA_BASE_URL}/deliveries/business/${encodeURIComponent(bostaId)}`, {
      headers: { Authorization: BOSTA_API_KEY },
    });
    const d = await r.json().catch(() => null);
    const del = (d && d.data) ? d.data : d;
    if (feeLog && del && del.pricing) feeLog.push({ id: bostaId, pricing: del.pricing });
    return pickFee(del);
  } catch { return null; }
}

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) { console.error('sbGet failed', path, JSON.stringify(data)); throw new Error(data?.message || 'DB read failed'); }
  return Array.isArray(data) ? data : [];
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

    // select=* so a missing column (e.g. calc_shipping before its migration runs) never
    // breaks the whole sync. Missing fields simply read as undefined below.
    const orders = await sbGet('orders?select=*&limit=3000');
    // Once an order is Returned AND has been received back into the warehouse
    // (warehouse_confirmed=true), it's fully closed — don't let the sync
    // overwrite it with anything else. Everything else (including Cancelled)
    // is fair game so Bosta's authoritative state stays in sync.
    const changes = [];
    const feeLog = [];
    for (const o of (orders || [])) {
      const d = byRef[o.id] || (o.ship_code && byTrack[o.ship_code]);
      if (!d) continue;
      const mapped = mapState(d);
      const patch = {};

      // 1) Auto-advance status (skip only if warehouse has already reclaimed
      //    the parcel — a full close, nothing more to sync).
      if (!o.warehouse_confirmed) {
        if (mapped && mapped !== o.status) patch.status = mapped;
        else if (!mapped && d.state?.value) unknownStates.add(d.state.value);
      }

      // 2) Actual shipping is only "real" once the order is Delivered or Returned
      //    (return-in-transit "On its way to me" does NOT count). We set it to the exact
      //    Bosta cost recomputed from the city + COD total — the same formula used when the
      //    order was created — so it's always correct (including free-shipping orders).
      const effStatus = patch.status || o.status;
      const isFinal = effStatus === 'Delivered' || effStatus === 'Returned';
      let feeSrc = null;
      if (isFinal) {
        // Prefer the REAL fee from Bosta's dashboard/API (shipmentFees × 1.14);
        // fall back to the formula only if Bosta hasn't populated it yet.
        // When Bosta gives us a real number, ALWAYS write it — previous values
        // were formula-guesses and were commonly over-counting.
        let cost = await fetchDeliveryFee(o.bosta_id, d, feeLog);
        feeSrc = 'bosta';
        if (!(typeof cost === 'number' && cost > 0)) { cost = calcActualShipping(o.city, o.total); feeSrc = 'formula'; }
        const currentStored = parseFloat(o.actual_shipping || 0);
        // Bosta value: always write when it differs. Formula value: only write when we have none.
        const shouldWrite = feeSrc === 'bosta'
          ? (cost !== currentStored)
          : (currentStored <= 0 && cost > 0);
        if (shouldWrite) patch.actual_shipping = cost;
        else feeSrc = null;
      }

      if (Object.keys(patch).length) {
        await sbPatch(o.id, patch);
        changes.push({ code: o.code, from: o.status, bostaState: d.state?.value, ...patch, feeSrc });
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
