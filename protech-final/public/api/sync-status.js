// protech-final/api/sync-status.js
// Pulls delivery states from Bosta and updates order statuses to match.
// - Matches Bosta deliveries to orders by businessReference (= our order id) or trackingNumber.
// - Auto-advances: Processing -> In Transit -> Delivered -> On its way to me, + Awaiting Action.
// - Never auto-sets Returned or Cancelled (you do those manually), and skips orders already
//   Returned/Cancelled or returned-to-stock.
// - Tries to read the actual shipping fee from Bosta's pricing if present (usually empty).
import { tgNotifyStatusChange, tgSendDailySummary, tgConfigured } from './_telegram.js';

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
  const code = d?.state?.code;

  // 0) Bosta's own numeric state code is the most reliable signal when
  //    present. 45 = delivered (to customer); 46 = returned (back with us).
  if (code === 46) return 'Returned';

  // 1) TERMINAL states first — order arrived at its final destination.
  //    Any "returned…" wording means the parcel is (or is being sent) back
  //    to us. Also catch "delivered to <internal Bosta location>" which
  //    Bosta sometimes uses for a completed RETURN leg (not a customer
  //    delivery) — those are Returned, not Delivered.
  if (v === 'returned' || v.startsWith('returned') || v.includes('returned to')) return 'Returned';
  if (v.includes('deliver')) {
    if (v.includes('warehouse') || v.includes('business') || v.includes('merchant')
        || v.includes('sender') || v.includes('back to')) return 'Returned';
    return 'Delivered';
  }

  // 2) Customer refused / order cancelled by anyone — auto-set so the
  //    dashboard reflects reality. (Manual protection lives in the caller:
  //    if the order is ALREADY Cancelled or Returned it won't be re-touched.)
  if (v.includes('cancel') || v.includes('terminat') || v.includes('rejected')) return 'Cancelled';

  // 3) Awaiting merchant action.
  if (v.includes('exception') || v.includes('awaiting your action')
      || v.includes('awaiting action') || v.includes('on hold')
      || v.includes('action required') || v.includes('issue')) return 'Awaiting Action';

  // 4) Return leg heading BACK to the merchant.
  //    Signals — any of these means the parcel is coming back to us:
  //      a) explicit "return" / "back to" word in the state value
  //      b) an in-transit-like state with COD === 0 (no cash to collect,
  //         so this trip is not going TO the customer)
  //      c) an in-transit-like state where Bosta already tried the
  //         customer (deliveryAttemptsLength > 0). By this point we've
  //         already ruled out Delivered / Returned above, so if the
  //         parcel is still moving AND has been to the customer at least
  //         once, it's on its way back to us.
  const cod = extractCOD(d);
  const attempts = parseInt(d?.deliveryAttemptsLength || d?.attemptsCount || 0) || 0;
  const headingToCustomer = v.includes('heading') || v.includes('out for delivery')
      || v.includes('on its way to') || code === 41;
  const inTransitLike = v.includes('transit') || v.includes('progress')
      || v.includes('picked') || v.includes('warehouse')
      || v.includes('dispatch') || headingToCustomer;
  if (v.includes('return') || v.includes('back to')) return 'On its way to me';

  // 5a) Courier is actively going TO the customer — takes priority over
  //     the "already tried" check because a re-attempt is still an
  //     outbound trip, not a return leg.
  if (headingToCustomer) return 'Heading to Customer';

  // Does Bosta have a FUTURE retry scheduled for this parcel? If so
  // the parcel is being held at a hub waiting for another attempt —
  // customer postponed, or address is being corrected.
  const now = Date.now();
  const isFutureIso = (iso) => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return !isNaN(t) && t > now;
  };
  const retryScheduled = isFutureIso(d?.scheduledAt) || isFutureIso(d?.lastChanceToDeliverDate);

  // 5b) A failed attempt + still moving = coming back to us. But only
  //     treat "retry-scheduled" as a blocker when the parcel is
  //     STATIONARY at a hub (state.code 24 = Received at warehouse).
  //     If Bosta is actively moving it between hubs (state.code 30 or
  //     wording like "in transit between hubs"), it's physically on
  //     its way somewhere — after a failed attempt, that's back to us.
  const parcelIsStationaryAtHub = code === 24 || (v.includes('received at') && v.includes('warehouse'));
  const holdingForRetry = retryScheduled && parcelIsStationaryAtHub;
  const alreadyTriedAndFailed = attempts > 0 && !holdingForRetry;
  if (inTransitLike && (cod === 0 || alreadyTriedAndFailed)) return 'On its way to me';

  // 5b) Otherwise, generic outbound in-transit — "picked up",
  //     "received at warehouse", "in transit between hubs", etc.
  if (inTransitLike) return 'In Transit';

  // 6) Not-yet-picked-up.
  if (v === 'processing' || v.includes('created') || v.includes('pending') || v === 'new'
      || v.includes('pickup requested') || v.includes('awaiting pickup')
      || v.includes('ready to')) return 'Processing';

  return null; // unknown -> leave unchanged (logged below)
}

async function fetchAllDeliveries() {
  const all = [];
  // Bosta's `count` field is the current page size, not the grand total,
  // so paginate purely on "did we get a full page?" until we hit an empty
  // page or the safety cap.
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`${BOSTA_BASE_URL}/deliveries/search`, {
      method: 'POST',
      headers: { 'Authorization': BOSTA_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 100, page, pageNumber: page }),
    });
    const d = await r.json().catch(() => null);
    const list = d?.data?.deliveries || [];
    all.push(...list);
    if (list.length < 100) break;
  }
  return all;
}

// Pull the ACTUAL shipping fee Bosta charged out of a delivery object.
// Priority:
//   1) wallet.cashCycle.bosta_fees   — THE authoritative field. This is the
//      total Bosta actually deducted from the COD (shipping + collection +
//      opening_package + VAT), i.e. `cod − deposited_amt`. Only populated
//      once Bosta has closed the cash cycle for the shipment (i.e. after
//      delivery + confirmation). Includes any mid-trip reclassifications
//      (package resize, destination-sector correction, etc.).
//   2) top-level shipmentFees × 1.14 — the current price before VAT for the
//      delivery. Available earlier than the wallet, but changes if Bosta
//      reclassifies the package en-route (so may not match the invoice).
//   3) pricing.priceAfterVat / other legacy pricing fields.
const VAT_RATE = 0.14;
function pickFee(del) {
  if (!del || typeof del !== 'object') return null;
  // 1) Definitive — actual amount deducted, straight from the cash cycle.
  const walletFee = parseFloat(del.wallet?.cashCycle?.bosta_fees);
  if (!isNaN(walletFee) && walletFee > 0) return Math.round(walletFee);
  // 2) shipmentFees (base, pre-VAT) — reliable but changes if repriced.
  const base = parseFloat(del.shipmentFees);
  if (!isNaN(base) && base > 0) return Math.round(base * (1 + VAT_RATE));
  // 3) Fallbacks — pricing sub-object.
  const p = del.pricing || {};
  const cands = [
    p.priceAfterVat, p.total, p.businessAmount, p.shippingFee, p.deliveryFee,
    p.cost, p.amount, p.deliveryCost, p.finalPrice,
    del.priceAfterVat, del.shippingFee, del.deliveryFee, del.price, del.cost,
  ];
  for (const c of cands) { const n = parseFloat(c && c.amount != null ? c.amount : c); if (!isNaN(n) && n > 0) return n; }
  const preVat = parseFloat(p.priceBeforeVat);
  if (!isNaN(preVat) && preVat > 0) return Math.round(preVat * (1 + VAT_RATE));
  return null;
}

// Get the ACTUAL shipping fee Bosta charged for a delivery, from the individual delivery
// detail endpoint (the list/search leaves pricing empty). Returns { fee, cashCycleClosed }.
async function fetchDeliveryFee(bostaId, searchObj, feeLog) {
  const fromSearch = pickFee(searchObj);
  // Cash cycle is on the detail endpoint; the search hit never has it. So if we
  // short-circuit on the search fee, mark cashCycleClosed=false.
  if (fromSearch) return { fee: fromSearch, cashCycleClosed: false };
  if (!bostaId) return { fee: null, cashCycleClosed: false };
  try {
    const r = await fetch(`${BOSTA_BASE_URL}/deliveries/business/${encodeURIComponent(bostaId)}`, {
      headers: { Authorization: BOSTA_API_KEY },
    });
    const d = await r.json().catch(() => null);
    const del = (d && d.data) ? d.data : d;
    if (feeLog && del && del.pricing) feeLog.push({ id: bostaId, pricing: del.pricing });
    const walletFee = parseFloat(del?.wallet?.cashCycle?.bosta_fees);
    const cashCycleClosed = !isNaN(walletFee) && walletFee > 0;
    return { fee: pickFee(del), cashCycleClosed };
  } catch { return { fee: null, cashCycleClosed: false }; }
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

// Compose today's roll-up from the same Supabase snapshot the sync uses and
// send it to Telegram. Cairo day = UTC day + 2..3h depending on DST; matching
// on `created_at::date` in UTC is close enough for a summary that fires in
// the evening. Returned separately so ?action=daily-summary can call it
// without running the whole sync.
async function sendDailySummaryFromDb() {
  const orders = await sbGet('orders?select=id,status,total,created_at,cash_cycle_closed&limit=5000');
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const isToday = (iso) => !!iso && iso >= startOfDay;
  // Counts: new orders TODAY, all-time in-transit right now, orders placed
  // today that already delivered / returned + their revenue, and open
  // (still-estimated) cash cycles across the whole book.
  let newToday = 0, delivered = 0, returned = 0, inTransit = 0, cashCycleOpen = 0, revenue = 0;
  for (const o of orders) {
    if (isToday(o.created_at)) newToday++;
    const s = o.status;
    if (s === 'Delivered' && isToday(o.created_at)) { delivered++; revenue += parseFloat(o.total || 0); }
    if (s === 'Returned' && isToday(o.created_at)) returned++;
    if (s === 'In Transit' || s === 'Heading to Customer' || s === 'Processing') inTransit++;
    // Cash cycle is a per-order finalisation flag with no timestamp column;
    // we can only report the current open count, not "closed today".
    if ((s === 'Delivered' || s === 'Returned') && o.cash_cycle_closed !== true) cashCycleOpen++;
  }
  const dateLabel = now.toISOString().slice(0, 10);
  return tgSendDailySummary({ newToday, delivered, returned, inTransit, cashCycleOpen, revenue, dateLabel });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!BOSTA_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  // ?action=daily-summary short-circuits the sync — just compose today's
  // rollup from Supabase and telegram it. Called from the evening cron.
  const action = (req.query?.action || '').toString();
  if (action === 'daily-summary') {
    try {
      const r = await sendDailySummaryFromDb();
      return res.status(200).json({ ok: true, telegram: r });
    } catch (e) {
      console.error('daily-summary error', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ?summary=1 runs the normal sync AND fires the summary afterwards.
  const alsoSummary = req.query?.summary === '1' || req.query?.summary === 'true';

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
    const detailFetchStats = { attempted: 0, ok: 0, failed: 0, remapped: 0, errors: [] };
    // Every status flip goes here as { order, from, to } so we can telegram
    // them all in one Promise.all after the sync finishes — spreads the
    // Telegram rate limit and keeps DB writes on the critical path.
    const statusFlips = [];
    // Also collect cash-cycle closures so we can ping "🔒 cycle closed"
    // (the confirmed-profit moment) separately from the status flip itself.
    const cashCycleFlips = [];
    // Debug trace: when ?only=<code> is passed, emit a step-by-step trace
    // for that one order (whether it was matched to a Bosta delivery,
    // what mapState returned at each step, what patch was applied, etc.)
    const onlyCode = (req.query?.only || '').toString().trim();
    let onlyTrace = null;
    for (const o of (orders || [])) {
      const trace = (onlyCode && o.code === onlyCode) ? (onlyTrace = { code: o.code, steps: [] }) : null;
      let d = byRef[o.id] || (o.ship_code && byTrack[o.ship_code]);
      if (trace) trace.steps.push({ step: 'match', matchedByRef: !!byRef[o.id], matchedByTrack: !!(o.ship_code && byTrack[o.ship_code]), hasD: !!d });
      if (!d) continue;
      let mapped = mapState(d);
      if (trace) trace.steps.push({ step: 'search-mapState', bostaState: d.state?.value, bostaCode: d.state?.code, mapped });

      // Whenever the search hit maps to In Transit / Processing, re-fetch
      // the detail endpoint (which has deliveryAttemptsLength and
      // cod_collectedAmount) and re-map — this is the only way to tell a
      // real in-transit trip from a return leg.
      const isInTransitLike = mapped === 'In Transit' || mapped === 'Processing';
      const bostaIdForDetail = o.bosta_id || d._id;
      if (trace) trace.steps.push({ step: 'inTransitLike?', isInTransitLike, bostaIdForDetail });
      if (isInTransitLike && bostaIdForDetail) {
        detailFetchStats.attempted++;
        try {
          const dr = await fetch(`${BOSTA_BASE_URL}/deliveries/business/${encodeURIComponent(bostaIdForDetail)}`, {
            headers: { Authorization: BOSTA_API_KEY },
          });
          if (dr.ok) {
            detailFetchStats.ok++;
            const dj = await dr.json().catch(() => null);
            const detail = dj?.data || dj;
            if (detail) {
              const newMapped = mapState(detail);
              if (trace) trace.steps.push({ step: 'detail-mapState', detailState: detail.state?.value, detailCode: detail.state?.code, attempts: detail.deliveryAttemptsLength, cod: detail.cod, cod_collected: detail.cod_collectedAmount, prevMapped: mapped, newMapped });
              if (newMapped !== mapped) detailFetchStats.remapped++;
              d = detail; mapped = newMapped;
            }
          } else {
            detailFetchStats.failed++;
            if (detailFetchStats.errors.length < 5) detailFetchStats.errors.push({ code: o.code, status: dr.status });
          }
        } catch (e) {
          detailFetchStats.failed++;
          if (detailFetchStats.errors.length < 5) detailFetchStats.errors.push({ code: o.code, err: e.message });
        }
      }

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
        // Prefer the REAL fee from Bosta's dashboard/API (wallet.cashCycle.bosta_fees,
        // then shipmentFees × 1.14); fall back to the formula only if Bosta hasn't
        // populated either yet. When Bosta gives us a real number, ALWAYS overwrite.
        // Use Bosta's internal id from the search hit if the order doesn't have one
        // stored (older orders may pre-date the bosta_id column being populated).
        const bostaId = o.bosta_id || d._id;
        if (!o.bosta_id && d._id) patch.bosta_id = d._id;
        const feeInfo = await fetchDeliveryFee(bostaId, d, feeLog);
        let cost = feeInfo.fee;
        let cashCycleClosed = feeInfo.cashCycleClosed;
        feeSrc = 'bosta';
        if (!(typeof cost === 'number' && cost > 0)) {
          cost = calcActualShipping(o.city, o.total);
          feeSrc = 'formula';
          cashCycleClosed = false;
        }
        const currentStored = parseFloat(o.actual_shipping || 0);
        // Bosta value: always write when it differs. Formula value: only write when we have none.
        const shouldWrite = feeSrc === 'bosta'
          ? (cost !== currentStored)
          : (currentStored <= 0 && cost > 0);
        if (shouldWrite) patch.actual_shipping = cost;
        else feeSrc = null;
        // Always keep the cash-cycle flag fresh so the dashboard badge is accurate,
        // even on runs where the fee itself didn't change.
        if (o.cash_cycle_closed !== cashCycleClosed) patch.cash_cycle_closed = cashCycleClosed;
      }

      if (trace) trace.steps.push({ step: 'patch', currentStatus: o.status, finalMapped: mapped, patch, warehouse_confirmed: o.warehouse_confirmed });
      if (Object.keys(patch).length) {
        const r = await sbPatch(o.id, patch);
        // If cash_cycle_closed column doesn't exist yet (migration not run),
        // retry without it so the rest of the sync still succeeds.
        if (!r.ok && 'cash_cycle_closed' in patch) {
          const { cash_cycle_closed, ...rest } = patch;
          if (Object.keys(rest).length) await sbPatch(o.id, rest);
        }
        if (trace) trace.steps.push({ step: 'sbPatch', ok: r.ok, status: r.status });
        changes.push({ code: o.code, from: o.status, bostaState: d.state?.value, ...patch, feeSrc });
        if (patch.status && patch.status !== o.status) {
          statusFlips.push({ order: o, from: o.status, to: patch.status });
        }
        if (patch.cash_cycle_closed === true && o.cash_cycle_closed !== true) {
          cashCycleFlips.push(o);
        }
      } else if (trace) {
        trace.steps.push({ step: 'no-patch', reason: 'empty' });
      }
    }
    // ─── BACKFILL PASS ──────────────────────────────────────────────
    // The search endpoint only returns the last ~1500 deliveries. Any
    // order that has a stored bosta_id but wasn't in that batch never
    // gets inspected by the main loop, so both its status AND the
    // cash-cycle flag stay stale. This second pass hits Bosta's detail
    // endpoint directly for every not-yet-fully-closed order, running
    // the same mapState + fee logic. Cap at 200 per run so a huge
    // backlog gets processed over multiple runs.
    const seenIds = new Set(Object.values(byRef).map(d => d._id).filter(Boolean));
    const isTerminal = (o) => {
      if (o.status === 'Cancelled') return true;
      // Delivered + cash cycle closed = fully settled, nothing to refresh.
      if (o.status === 'Delivered' && o.cash_cycle_closed === true) return true;
      // Returned + warehouse confirmed = goods returned to supplier, fully closed.
      if (o.status === 'Returned' && o.warehouse_confirmed) return true;
      return false;
    };
    const backfillCandidates = (orders || []).filter(o =>
      o.bosta_id
      && !isTerminal(o)
      && !seenIds.has(o.bosta_id)
    ).slice(0, 200);
    const backfillChanges = [];
    const backfillErrors = [];
    for (const o of backfillCandidates) {
      try {
        const r = await fetch(`${BOSTA_BASE_URL}/deliveries/business/${encodeURIComponent(o.bosta_id)}`, {
          headers: { Authorization: BOSTA_API_KEY },
        });
        if (!r.ok) { backfillErrors.push({ code: o.code, why: `fetch ${r.status}` }); continue; }
        const d = await r.json().catch(() => null);
        const del = d?.data || d;
        if (!del) { backfillErrors.push({ code: o.code, why: 'empty response' }); continue; }
        const patch = {};
        // 1) Status — same mapping logic as the main loop.
        if (!o.warehouse_confirmed) {
          const mapped = mapState(del);
          if (mapped && mapped !== o.status) patch.status = mapped;
        }
        // 2) Actual shipping + cash-cycle flag (only meaningful once the
        //    order has reached a final state).
        const effStatus = patch.status || o.status;
        if (effStatus === 'Delivered' || effStatus === 'Returned') {
          const walletFee = parseFloat(del?.wallet?.cashCycle?.bosta_fees);
          const cashCycleClosed = !isNaN(walletFee) && walletFee > 0;
          const cost = pickFee(del);
          if (typeof cost === 'number' && cost > 0 && cost !== parseFloat(o.actual_shipping || 0)) {
            patch.actual_shipping = cost;
          }
          if (o.cash_cycle_closed !== cashCycleClosed) patch.cash_cycle_closed = cashCycleClosed;
        }
        if (Object.keys(patch).length) {
          const pr = await sbPatch(o.id, patch);
          if (!pr.ok && 'cash_cycle_closed' in patch) {
            const { cash_cycle_closed, ...rest } = patch;
            if (Object.keys(rest).length) await sbPatch(o.id, rest);
          }
          backfillChanges.push({ code: o.code, from: o.status, ...patch });
          if (patch.status && patch.status !== o.status) {
            statusFlips.push({ order: o, from: o.status, to: patch.status });
          }
          if (patch.cash_cycle_closed === true && o.cash_cycle_closed !== true) {
            cashCycleFlips.push(o);
          }
        } else {
          backfillErrors.push({ code: o.code, why: 'no patch', bostaState: del?.state?.value, currentStatus: o.status });
        }
      } catch (e) { backfillErrors.push({ code: o.code, why: 'exception: ' + e.message }); }
    }

    // ── Telegram notifications ──────────────────────────────────────
    // Fan-out is done after all DB writes so a slow/failed Telegram call
    // never delays sync. Serialised (not Promise.all) so we stay well under
    // the 30 msg/sec Telegram limit even on a huge backlog.
    let tgSent = { statusFlips: 0, cashCycleFlips: 0, summary: false, skipped: false };
    if (tgConfigured()) {
      for (const flip of statusFlips) {
        try { await tgNotifyStatusChange(flip.order, flip.from, flip.to); tgSent.statusFlips++; } catch {}
      }
      for (const o of cashCycleFlips) {
        try {
          await tgNotifyStatusChange({ ...o, code: o.code }, o.status, '🔒 Cash Cycle Closed');
          tgSent.cashCycleFlips++;
        } catch {}
      }
      if (alsoSummary) {
        try { await sendDailySummaryFromDb(); tgSent.summary = true; } catch (e) { console.warn('daily-summary from sync failed', e.message); }
      }
    } else {
      tgSent.skipped = true;
    }

    const result = { ok: true, buildMarker: 'v7-telegram-alerts', bostaDeliveries: deliveries.length, ordersChecked: (orders || []).length, updated: changes.length, changes, unknownStates: [...unknownStates], feeSamples: feeLog.slice(0, 8), detailFetchStats, backfill: { checked: backfillCandidates.length, updated: backfillChanges.length, changes: backfillChanges.slice(0, 20), errors: backfillErrors.slice(0, 20) }, telegram: tgSent, onlyTrace };
    console.log('sync-status', JSON.stringify(result));
    return res.status(200).json(result);
  } catch (e) {
    console.error('sync-status error', e.message);
    return res.status(500).json({ error: e.message });
  }
}
