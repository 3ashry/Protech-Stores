// protech-final/public/api/wa-webhook.js
// Receives WhatsApp Business Cloud API webhook events and records the customer's
// reply to the order-confirmation message on the order (customer_confirmed),
// which the dashboard shows as "✅ العميل أكد الحجز".
//
// Recognises the reply whether it arrives as:
//   - a quick-reply BUTTON tap (payload CONFIRM/CANCEL, or the Arabic button text), or
//   - a free-TEXT message ("تأكيد" / "إلغاء").
// Matches it to the order first by the stored message id (wa_msg_id), and if that
// misses, by the sender's phone number (newest order still awaiting a reply).
//
// Required Vercel env vars:
//   WA_VERIFY_TOKEN  - the random string you also paste into Meta's webhook config
//   SUPABASE_URL     - https://wljxplbcfoorqpoflcdz.supabase.co
//   SUPABASE_KEY     - Supabase SECRET (service_role) key
import { waPhone } from './_wa.js';

const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const d = await r.json().catch(() => null);
  return Array.isArray(d) ? d : [];
}
// PATCH and return the affected rows, so we can tell whether anything matched.
async function sbPatchRep(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

const CONFIRM_RE = /تأكيد|تاكيد|أكد|اكد|confirm|نعم|موافق|تمام|أوافق/i;
const CANCEL_RE = /إلغاء|الغاء|ألغاء|cancel|رفض|لا اريد|لا أريد|مش عايز|مش عاوز/i;

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

  // Always 200 quickly so Meta doesn't retry; do the work inside try.
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (!msg || !SUPABASE_URL || !SUPABASE_KEY) return res.status(200).json({ received: true });

    // Work out the customer's intent from a button tap OR a typed message.
    let intent = null; // 'confirm' | 'cancel'
    if (msg.type === 'button') {
      const payload = msg.button?.payload || '';
      const text = msg.button?.text || '';
      if (payload === 'CONFIRM' || CONFIRM_RE.test(text)) intent = 'confirm';
      else if (payload === 'CANCEL' || CANCEL_RE.test(text)) intent = 'cancel';
    } else if (msg.type === 'interactive') {
      // Interactive reply-button style, just in case.
      const br = msg.interactive?.button_reply || {};
      const id = br.id || '', title = br.title || '';
      if (id === 'CONFIRM' || CONFIRM_RE.test(title)) intent = 'confirm';
      else if (id === 'CANCEL' || CANCEL_RE.test(title)) intent = 'cancel';
    } else if (msg.type === 'text') {
      const body = (msg.text?.body || '').trim();
      if (CONFIRM_RE.test(body)) intent = 'confirm';
      else if (CANCEL_RE.test(body)) intent = 'cancel';
    }

    if (intent) {
      const update = intent === 'confirm'
        ? { customer_confirmed: true }
        : { customer_confirmed: false, status: 'Cancelled' };

      // 1) Precise: match the order by the id of the template message we sent.
      let updated = [];
      const repliedToId = msg.context?.id;
      if (repliedToId) updated = await sbPatchRep(`orders?wa_msg_id=eq.${encodeURIComponent(repliedToId)}`, update);

      // 2) Fallback: match by the sender's phone → newest messaged, unresolved order.
      if (!updated.length) {
        const from = String(msg.from || '').replace(/\D/g, '');
        if (from) {
          const rows = await sbGet('orders?select=id,phone,wa_sent_at&customer_confirmed=is.null&wa_msg_id=not.is.null&order=wa_sent_at.desc&limit=100');
          const match = rows.find(o => waPhone(o.phone) === from);
          if (match) await sbPatchRep(`orders?id=eq.${encodeURIComponent(match.id)}`, update);
        }
      }
    }
  } catch (e) {
    console.error('wa-webhook error:', e.message);
  }
  return res.status(200).json({ received: true });
}
