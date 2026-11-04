// protech-final/api/bosta.js
// Vercel Serverless Function — runs right after an order is placed (the
// storefront posts here) and from the dashboard's "Send to Aramex" button.
// The path stays /api/bosta so cached checkout pages keep working, but the
// courier is now Aramex: WhatsApp confirmation first, then the Aramex COD
// shipment (tracking number, label, estimated charge saved on the order).
//
// Secrets are read from environment variables (Vercel → Project → Settings →
// Environment Variables). Never hardcode keys here — this file is in source control.
import { tgNotifyOrder } from './_telegram.js';
import { sendPushForOrder } from './_push.js';
import { sendConfirmTemplate, waConfigured } from './_wa.js';
import { aramexConfigured, aramexCreateShipment, aramexEstimate, aramexOrderWeight } from './_aramex.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Comma-separated list of allowed browser origins, e.g.
//   ALLOWED_ORIGINS="https://protech-stores.vercel.app,https://protechstores.com"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function corsHeaders(req) {
  const origin = req.headers.origin;
  // With an allowlist configured, only echo a matching origin; otherwise fall back to '*'
  // (functional, but set ALLOWED_ORIGINS to lock this down).
  const allow = ALLOWED_ORIGINS.length
    ? (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0])
    : '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// Supabase REST helper (service-role key — can update products despite RLS).
function sbFetch(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

// Take an order's quantities out of stock, once. stock_decremented_at makes it
// idempotent — a retry (e.g. "Send to Aramex" after a failed first try) never
// subtracts twice. Best-effort: never throws.
async function decrementStockForOrder(row) {
  if (!row || row.stock_decremented_at) return;
  try {
    for (const it of (Array.isArray(row.products) ? row.products : [])) {
      if (!it || !it.id) continue;
      const pr = await sbFetch(`products?id=eq.${encodeURIComponent(it.id)}&select=id,qty`);
      const prow = (await pr.json())?.[0];
      if (!prow) continue;
      const newQty = Math.max(0, (parseInt(prow.qty) || 0) - (parseInt(it.qty) || 0));
      await sbFetch(`products?id=eq.${encodeURIComponent(it.id)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ qty: newQty }),
      });
    }
    await sbFetch(`orders?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ stock_decremented_at: new Date().toISOString() }),
    });
  } catch (e) {
    console.warn('decrementStockForOrder failed (order still saved):', e.message);
  }
}

export default async function handler(req, res) {
  const CORS = corsHeaders(req);
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method !== 'POST') return res.status(405).end();
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('bosta.js missing env config (SUPABASE_URL / SUPABASE_KEY)');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const body = req.body || {};
  const orderId = String(body.orderId || '');
  // orderId is interpolated into PostgREST filter URLs — only safe id chars.
  if (!/^[A-Za-z0-9_-]+$/.test(orderId)) return res.status(400).json({ error: 'Invalid orderId' });
  // retry = the dashboard's "Send to Aramex" button: no new-order alerts.
  const isRetry = body.retry === true || body.retry === 'true';

  // The order row is the source of truth (the storefront inserted it just
  // before calling us); the request body only fills a second phone that an
  // older checkout page may not have stored.
  const orderRes = await sbFetch(`orders?id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`);
  const order = ((await orderRes.json().catch(() => [])) || [])[0];
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const sbPatch = (patch) => sbFetch(`orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
  });
  if (!order.second_phone && body.secondPhone) {
    order.second_phone = String(body.secondPhone);
    try { await sbPatch({ second_phone: order.second_phone }); } catch (_) {}
  }

  await decrementStockForOrder(order);

  if (!isRetry) {
    // Best-effort alerts — never block or break the flow.
    tgNotifyOrder({ orderId, customerName: order.customer_name, phone: order.phone, city: order.city, address: order.address, total: order.total, allowOpen: true })
      .catch(e => console.warn('telegram notify failed:', e && e.message));
    sendPushForOrder({ id: orderId, code: order.code || orderId, customer_name: order.customer_name, city: order.city, total: order.total })
      .catch(e => console.warn('web push failed:', e && e.message));
  }

  // Estimated (agreed) Aramex charge from the price list — compared later
  // with what Aramex actually bills.
  const lines = Array.isArray(order.products) ? order.products : [];
  let productsById = new Map();
  try {
    const ids = [...new Set(lines.map(l => l && l.id).filter(Boolean))];
    if (ids.length) {
      const inList = ids.map(id => `"${String(id).replace(/"/g, '')}"`).join(',');
      const pr = await sbFetch(`products?id=in.(${encodeURIComponent(inList)})&select=id,unit_weight_kg,unit_volume_cm3`);
      productsById = new Map(((await pr.json().catch(() => [])) || []).map(p => [p.id, p]));
    }
  } catch (_) {}
  const weightKg = aramexOrderWeight(lines, productsById);
  const estimate = aramexEstimate(order.city, weightKg, order.total);

  // ── STEP 1: WhatsApp confirmation first (once), independent of the courier.
  let waResult = { skipped: true };
  if (!order.wa_sent_at && waConfigured()) {
    try {
      const sent = await sendConfirmTemplate({ ...order, est_shipping: estimate.total, allow_open: true, ship_code: '' });
      if (sent?.ok) {
        waResult = { sent: true, msgId: sent.msgId };
        await sbPatch({ wa_msg_id: sent.msgId, wa_sent_at: new Date().toISOString() }).catch(() => {});
      } else {
        console.error('bosta.js WA confirm failed:', JSON.stringify(sent?.error || sent));
        waResult = { sent: false, error: sent?.error || sent };
      }
    } catch (e) {
      console.error('bosta.js WA confirm exception:', e && e.message);
      waResult = { sent: false, exception: String(e && e.message || e) };
    }
  }

  // ── STEP 2: Aramex shipment (once). On failure the order stays Processing
  // with ship_error set; the dashboard shows "Send to Aramex" to retry.
  if (order.ship_code) {
    return res.status(200).json({ success: true, already: true, trackingNumber: order.ship_code, whatsapp: waResult });
  }
  if (!aramexConfigured()) {
    await sbPatch({ courier: 'aramex', ship_error: 'Aramex settings missing in Vercel', calc_shipping: estimate.total }).catch(() => {});
    return res.status(200).json({ success: false, error: 'Aramex not configured', whatsapp: waResult });
  }
  try {
    const r = await aramexCreateShipment(order, { weightKg });
    if (!r.ok) {
      const msg = (r.errors.map(e => `${e.code} ${e.message}`.trim()).join(' | ') || r.nonJson || `HTTP ${r.httpStatus}`).slice(0, 500);
      console.error('Aramex create failed', order.code, msg);
      await sbPatch({ courier: 'aramex', ship_error: msg, calc_shipping: estimate.total }).catch(() => {});
      return res.status(200).json({ success: false, aramexError: msg, whatsapp: waResult });
    }
    await sbPatch({
      courier: 'aramex', ship_code: r.awb, shipping_label_url: r.labelUrl, ship_error: null,
      ship_sent_at: new Date().toISOString(), calc_shipping: estimate.total, actual_shipping: 0,
    });
    console.log('Aramex shipment created', order.code, r.awb);
    return res.status(200).json({ success: true, trackingNumber: r.awb, labelUrl: r.labelUrl, estimate, whatsapp: waResult });
  } catch (e) {
    console.error('bosta.js Aramex exception:', e.message);
    await sbPatch({ courier: 'aramex', ship_error: String(e.message).slice(0, 500), calc_shipping: estimate.total }).catch(() => {});
    return res.status(200).json({ success: false, error: e.message, whatsapp: waResult });
  }
}
