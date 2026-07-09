// protech-final/public/api/wa-webhook.js
// Receives WhatsApp Business Cloud API webhook events and records the customer's
// reply to the order-confirmation message on the order (customer_confirmed),
// which the dashboard shows as "✅ العميل أكد الحجز".
//
// Handles two reply styles:
//   1) Quick-reply BUTTON tap (CONFIRM / CANCEL) — mapped precisely via the
//      stored message id (wa_msg_id) that the confirmation was sent with.
//   2) Free-TEXT reply (customer types "تأكيد" / "إلغاء") — mapped to that
//      phone number's most recent order still awaiting a reply.
//
// Required Vercel env vars:
//   WA_VERIFY_TOKEN  - any random string you also paste into Meta's webhook config
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
async function sbPatch(path, body) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
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

    // ── 1) Quick-reply button tap (precise: mapped by the sent message id) ──
    if (msg.type === 'button') {
      const payload = msg.button?.payload || msg.button?.text || '';
      const repliedToId = msg.context?.id; // id of the template message we sent
      if (repliedToId) {
        const update =
          payload === 'CONFIRM' ? { customer_confirmed: true }
          : payload === 'CANCEL' ? { customer_confirmed: false, status: 'Cancelled' }
          : null;
        if (update) await sbPatch(`orders?wa_msg_id=eq.${encodeURIComponent(repliedToId)}`, update);
      }
      return res.status(200).json({ received: true });
    }

    // ── 2) Free-text reply ("تأكيد" / "إلغاء") — match by sender phone ──
    if (msg.type === 'text') {
      const body = (msg.text?.body || '').trim();
      const isConfirm = CONFIRM_RE.test(body);
      const isCancel = CANCEL_RE.test(body);
      if (isConfirm || isCancel) {
        const from = String(msg.from || '').replace(/\D/g, '');
        // Newest order from this number that we've messaged and is still awaiting a reply.
        const rows = await sbGet('orders?select=id,phone,wa_sent_at&customer_confirmed=is.null&wa_msg_id=not.is.null&order=wa_sent_at.desc&limit=100');
        const match = rows.find(o => waPhone(o.phone) === from);
        if (match) {
          await sbPatch(`orders?id=eq.${encodeURIComponent(match.id)}`,
            isConfirm ? { customer_confirmed: true } : { customer_confirmed: false, status: 'Cancelled' });
        }
      }
    }
  } catch (e) {
    console.error('wa-webhook error:', e.message);
  }
  return res.status(200).json({ received: true });
}
