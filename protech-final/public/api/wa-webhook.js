// protech-final/public/api/wa-webhook.js
// Receives WhatsApp Business Cloud API webhook events. When the customer taps a
// quick-reply button on the order-confirmation template, this maps the reply back to
// the order (via the stored message id) and updates its status in Supabase.
//
// Required Vercel env vars:
//   WA_VERIFY_TOKEN  - any random string you also paste into Meta's webhook config
//   SUPABASE_URL     - https://wljxplbcfoorqpoflcdz.supabase.co
//   SUPABASE_KEY     - Supabase SECRET (service_role) key
const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function sbPatch(path, body) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal',
    },
    body: JSON.stringify(body),
  });
}

export default async function handler(req, res) {
  // 1) Webhook verification handshake (Meta calls this once with GET).
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token && token === WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).end();
  }

  if (req.method !== 'POST') return res.status(405).end();

  // Always 200 quickly so Meta doesn't retry; do the work after.
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const msg = change?.messages?.[0];

    // We only care about quick-reply button taps on our template.
    if (msg && msg.type === 'button') {
      const payload = msg.button?.payload || msg.button?.text || '';
      const repliedToId = msg.context?.id; // the id of the template message we sent
      if (repliedToId) {
        const update =
          payload === 'CONFIRM' ? { customer_confirmed: true }
          : payload === 'CANCEL' ? { customer_confirmed: false, status: 'Cancelled' }
          : null;
        if (update && SUPABASE_URL && SUPABASE_KEY) {
          await sbPatch(`orders?wa_msg_id=eq.${encodeURIComponent(repliedToId)}`, update);
        }
      }
    }
  } catch (e) {
    console.error('wa-webhook error:', e.message);
  }
  return res.status(200).json({ received: true });
}
