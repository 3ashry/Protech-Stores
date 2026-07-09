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

// Send the approved order-confirmation template.
// Body params: {{1}} customer name, {{2}} order code, {{3}} total.
// Two quick-reply buttons: index 0 -> CONFIRM, index 1 -> CANCEL (payloads the
// webhook reads back). Returns { ok, msgId, error }.
export async function sendConfirmTemplate({ phone, customerName, code, total }) {
  const r = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: waPhone(phone),
      type: 'template',
      template: {
        name: WA_TEMPLATE_NAME,
        language: { code: WA_TEMPLATE_LANG },
        components: [
          { type: 'body', parameters: [
            { type: 'text', text: String(customerName || '') },
            { type: 'text', text: String(code || '') },
            { type: 'text', text: String(total ?? '') },
          ]},
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
