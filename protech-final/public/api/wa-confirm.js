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
import { sendConfirmTemplate } from './_wa.js';

const WA_TOKEN = process.env.WA_TOKEN;
const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
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

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Immediate order-confirmation sending is DISABLED. Confirmations are sent ~6h
  // after the order by the scheduled sender (/api/wa-cron), which waits for the
  // Bosta ship code. Cached storefront builds may still call this endpoint at
  // checkout — return a no-op so no message is sent before the ship code exists.
  return res.status(200).json({ disabled: true, note: 'confirmation is sent by the 6h scheduler (wa-cron)' });

  /* eslint-disable no-unreachable */
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error('wa-confirm: missing env config');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const { orderId } = req.body || {};
  if (!orderId) return res.status(400).json({ error: 'Missing orderId' });
  if (!/^[A-Za-z0-9_-]+$/.test(String(orderId))) return res.status(400).json({ error: 'Invalid orderId' });

  try {
    // Load the full order so the message carries the same itemised details
    // (products, shipping, total, open-package, ship code) as the automatic sender.
    const oRes = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,code,phone,customer_name,total,est_shipping,allow_open,ship_code,products&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    const order = (await oRes.json().catch(() => []))[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.phone) return res.status(400).json({ error: 'Order has no phone' });

    // Send the approved template (shared with the automatic 6h sender).
    const r = await sendConfirmTemplate(order);
    if (!r.ok) {
      console.error('wa-confirm send error:', JSON.stringify(r.error));
      return res.status(502).json({ error: 'WhatsApp send failed', details: r.error });
    }
    const msgId = r.msgId;

    // Store the sent message id on the order so the webhook can find it on reply,
    // and stamp wa_sent_at so the automatic cron never re-sends this order.
    await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ wa_msg_id: msgId, wa_sent_at: new Date().toISOString(), customer_confirmed: null }),
    });
    return res.status(200).json({ success: true, messageId: msgId });
  } catch (e) {
    console.error('wa-confirm exception:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
