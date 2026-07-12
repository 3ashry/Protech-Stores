// protech-final/public/api/_wa.js
// Shared WhatsApp Business Cloud API helpers, used by:
//   - wa-confirm.js  (manual "send confirmation now" from the dashboard)
//   - wa-cron.js     (automatic send 6 hours after the order is placed)
// The leading underscore tells Vercel NOT to expose this file as its own
// endpoint — it's an internal module only.
//
// Env vars (set in Vercel):
//   WA_TOKEN            permanent WhatsApp access token (System User token)
//   WA_PHONE_NUMBER_ID  the Phone Number ID from Meta (not the phone number)
//   WA_TEMPLATE_NAME    approved template name (default "order_confirm")
//   WA_TEMPLATE_LANG    template language code (default "ar")
const WA_TOKEN = process.env.WA_TOKEN;
const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const WA_TEMPLATE_NAME = process.env.WA_TEMPLATE_NAME || 'order_confirm';
const WA_TEMPLATE_LANG = process.env.WA_TEMPLATE_LANG || 'ar';

export function waConfigured() {
  return !!(WA_TOKEN && WA_PHONE_NUMBER_ID);
}

// Egypt: turn a local 01XXXXXXXXX into international 201XXXXXXXXX (no +).
export function waPhone(p) {
  let s = String(p || '').replace(/\D/g, '');
  if (s.startsWith('0')) s = '20' + s.slice(1);
  else if (!s.startsWith('20')) s = '20' + s;
  return s;
}

// Send a plain text message. Only allowed within the 24h customer-service window
// (i.e. right after the customer messages us) — which is exactly when we use it,
// to auto-reply after a confirm/cancel. Returns { ok, data }.
export async function sendText(to, body) {
  const r = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: waPhone(to),
      type: 'text',
      text: { body: String(body || '') },
    }),
  });
  const data = await r.json().catch(() => null);
  return { ok: r.ok, data };
}

// Number with thousands separators, Latin digits (safe inside a template var).
function fmtNum(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US');
}

// Build the single-line items summary for {{2}}. Meta forbids newlines, tabs and
// runs of >4 spaces inside a template variable, so products are comma-joined on
// one line: "اسم المنتج × 2 — 1,000 ج.م ، منتج آخر × 1 — 500 ج.م".
function itemsSummary(products) {
  const list = Array.isArray(products) ? products : [];
  const s = list
    .map(p => `${p.name || p.code || 'منتج'} × ${p.qty || 1} — ${fmtNum((p.sell_price || p.price || 0) * (p.qty || 1))} ج.م`)
    .join(' ، ')
    .replace(/[\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  return s || '—';
}

// Send the approved order-confirmation template. Pass an order row (DB shape).
// Body params, in order:
//   {{1}} customer name   {{2}} items summary   {{3}} shipping fee (customer)
//   {{4}} grand total     {{5}} open-package    {{6}} shipping code
// Two quick-reply buttons: index 0 -> CONFIRM, index 1 -> CANCEL (payloads the
// webhook reads back). Returns { ok, msgId, error }.
export async function sendConfirmTemplate(order = {}) {
  const params = [
    String(order.customer_name || 'عميلنا العزيز'),
    itemsSummary(order.products),
    fmtNum(order.est_shipping || 0),
    fmtNum(order.total || 0),
    order.allow_open ? 'متاح' : 'غير متاح',
    String(order.ship_code || 'سيتم إرساله قريباً'),
  ];
  const r = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: waPhone(order.phone),
      type: 'template',
      template: {
        name: WA_TEMPLATE_NAME,
        language: { code: WA_TEMPLATE_LANG },
        components: [
          { type: 'body', parameters: params.map(text => ({ type: 'text', text })) },
          { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'CONFIRM' }] },
          { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'CANCEL' }] },
        ],
      },
    }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) return { ok: false, error: data };
  return { ok: true, msgId: data?.messages?.[0]?.id || null };
}
