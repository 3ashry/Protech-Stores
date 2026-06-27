// protech-final/public/api/wa-confirm.js
// Sends a WhatsApp "confirm / cancel your order" template to the customer via the
// WhatsApp Business Cloud API, then stores the sent message id on the order so the
// webhook can map the customer's button tap back to this order.
//
// Required Vercel env vars:
//   WA_TOKEN              - permanent WhatsApp Business access token (System User token)
//   WA_PHONE_NUMBER_ID    - the Phone Number ID from Meta (not the phone number itself)
//   WA_TEMPLATE_NAME      - approved template name (e.g. "order_confirm")
//   WA_TEMPLATE_LANG      - template language code (e.g. "ar")
//   SUPABASE_URL          - https://wljxplbcfoorqpoflcdz.supabase.co
//   SUPABASE_KEY          - Supabase SECRET (service_role) key
//   ALLOWED_ORIGINS       - (optional) comma-separated allowed browser origins
const WA_TOKEN = process.env.WA_TOKEN;
const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const WA_TEMPLATE_NAME = process.env.WA_TEMPLATE_NAME || 'order_confirm';
const WA_TEMPLATE_LANG = process.env.WA_TEMPLATE_LANG || 'ar';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;
  const allow = ALLOWED_ORIGINS.length
    ? (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]) : '*';
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Egypt: turn a local 01XXXXXXXXX into international 201XXXXXXXXX (no +).
function waPhone(p) {
  let s = String(p || '').replace(/\D/g, '');
  if (s.startsWith('0')) s = '20' + s.slice(1);
  else if (!s.startsWith('20')) s = '20' + s;
  return s;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error('wa-confirm: missing env config');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const { orderId, phone, customerName, code, total } = req.body || {};
  if (!orderId || !phone) return res.status(400).json({ error: 'Missing orderId or phone' });
  if (!/^[A-Za-z0-9_-]+$/.test(String(orderId))) return res.status(400).json({ error: 'Invalid orderId' });

  try {
    // Send the approved template. Two quick-reply buttons; we set their payloads here
    // (index 0 = CONFIRM, index 1 = CANCEL) so the webhook gets a clean value.
    const waRes = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
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
              { type: 'text', text: String(code || orderId) },
              { type: 'text', text: String(total ?? '') },
            ]},
            { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'CONFIRM' }] },
            { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'CANCEL' }] },
          ],
        },
      }),
    });
    const waData = await waRes.json();
    if (!waRes.ok) {
      console.error('wa-confirm send error:', JSON.stringify(waData));
      return res.status(502).json({ error: 'WhatsApp send failed', details: waData });
    }
    const msgId = waData?.messages?.[0]?.id || null;

    // Store the sent message id on the order so the webhook can find it on reply.
    if (msgId) {
      await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json', 'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ wa_msg_id: msgId, customer_confirmed: null }),
      });
    }
    return res.status(200).json({ success: true, messageId: msgId });
  } catch (e) {
    console.error('wa-confirm exception:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
