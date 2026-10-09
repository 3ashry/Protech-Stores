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
import { waPhone, sendText } from './_wa.js';

// Auto-replies sent back to the customer after they confirm / cancel.
const CONFIRM_REPLY = 'شكراً لطلبك من بروتيك 😊\nمدة الشحن المتوقعة 3 أيام عمل.\nللاستفسار ابعتلنا على واتساب على الرقم ده: 01034482071';
const CANCEL_REPLY = 'تم إلغاء طلبك.';
// Phase 12 — reply after the customer taps "I have a problem with my order".
const PROBLEM_REPLY = 'تمام، سجّلنا إن عندك مشكلة في الطلب ✅ هنتواصل معاك في أقرب وقت على نفس الرقم.';
// Auto-reply after a rating tap on the feedback template.
const FEEDBACK_THANKS_HIGH = 'شكراً جداً لتقييمك 🌟\nيسعدنا خدمتك دائماً، ولو محتاج أي حاجة إحنا معاك.';
const FEEDBACK_THANKS_MID  = 'شكراً على تقييمك 🙏\nلو عندك أي ملاحظة تحب تشاركنا بيها، اكتبها هنا أو كلمنا على 01034482071.';
const FEEDBACK_THANKS_LOW  = 'شكراً على وقتك وصراحتك 🙏\nحابين نفهم إيه اللي مضايقك عشان نصلحه — اكتب لنا هنا أو كلمنا على 01034482071.';

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
const PROBLEM_RE = /مشكلة|مشكله|problem|شكوى|شكوي|خطأ|غلط/i;

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

    // ── Delivery-status events (Phase 12) ──────────────────────────────
    // A message that FAILED to deliver (bad number, blocked, etc.) flags
    // the order for a phone call so it never silently falls through.
    const statusEvt = change?.statuses?.[0];
    if (statusEvt && (statusEvt.status === 'failed' || statusEvt.status === 'undelivered') && SUPABASE_URL && SUPABASE_KEY) {
      const failedId = statusEvt.id;
      const reason = statusEvt.errors?.[0]?.title || statusEvt.errors?.[0]?.message || statusEvt.status;
      if (failedId) {
        const patch = { wa_delivery_failed: true, needs_call: true, needs_call_reason: 'فشل توصيل رسالة واتساب: ' + reason };
        for (const col of ['wa_msg_id', 'wa_prepared_msg_id', 'wa_shipped_msg_id']) {
          const rows = await sbPatchRep(`orders?${col}=eq.${encodeURIComponent(failedId)}`, patch);
          if (rows.length) break;
        }
      }
      return res.status(200).json({ received: true });
    }

    const msg = change?.messages?.[0];
    if (!msg || !SUPABASE_URL || !SUPABASE_KEY) return res.status(200).json({ received: true });

    // Work out the customer's intent from a button tap OR a typed message.
    // Intent is one of: 'confirm' | 'cancel' | 'rating' (with .rating = 5/3/1).
    let intent = null;
    let rating = null;
    const readRatingPayload = (p) => {
      if (p === 'RATING_5') return 5;
      if (p === 'RATING_3') return 3;
      if (p === 'RATING_1') return 1;
      return null;
    };
    if (msg.type === 'button') {
      const payload = msg.button?.payload || '';
      const text = msg.button?.text || '';
      const r = readRatingPayload(payload);
      if (r != null) { intent = 'rating'; rating = r; }
      else if (payload === 'PROBLEM' || PROBLEM_RE.test(text)) intent = 'problem';
      else if (payload === 'CONFIRM' || CONFIRM_RE.test(text)) intent = 'confirm';
      else if (payload === 'CANCEL' || CANCEL_RE.test(text)) intent = 'cancel';
    } else if (msg.type === 'interactive') {
      const br = msg.interactive?.button_reply || {};
      const id = br.id || '', title = br.title || '';
      const r = readRatingPayload(id);
      if (r != null) { intent = 'rating'; rating = r; }
      else if (id === 'PROBLEM' || PROBLEM_RE.test(title)) intent = 'problem';
      else if (id === 'CONFIRM' || CONFIRM_RE.test(title)) intent = 'confirm';
      else if (id === 'CANCEL' || CANCEL_RE.test(title)) intent = 'cancel';
    } else if (msg.type === 'text') {
      const body = (msg.text?.body || '').trim();
      if (PROBLEM_RE.test(body)) intent = 'problem';
      else if (CONFIRM_RE.test(body)) intent = 'confirm';
      else if (CANCEL_RE.test(body)) intent = 'cancel';
    }

    // ── Feedback rating branch ─────────────────────────────────────────
    if (intent === 'rating') {
      const patch = { feedback_rating: rating, feedback_at: new Date().toISOString() };
      let updated = [];
      // 1) Match by the id of the feedback template message we sent.
      const repliedToId = msg.context?.id;
      if (repliedToId) updated = await sbPatchRep(`orders?wa_feedback_msg_id=eq.${encodeURIComponent(repliedToId)}`, patch);
      // 2) Fallback: newest delivered order sent to this phone still without a rating.
      if (!updated.length) {
        const from = String(msg.from || '').replace(/\D/g, '');
        if (from) {
          const rows = await sbGet('orders?select=id,phone&status=eq.Delivered&feedback_rating=is.null&wa_feedback_sent_at=not.is.null&order=wa_feedback_sent_at.desc&limit=50');
          const match = rows.find(o => waPhone(o.phone) === from);
          if (match) await sbPatchRep(`orders?id=eq.${encodeURIComponent(match.id)}`, patch);
        }
      }
      // 3) Auto-reply: tailor the thank-you to how happy they said they were.
      if (msg.from) {
        const reply = rating >= 5 ? FEEDBACK_THANKS_HIGH : (rating >= 3 ? FEEDBACK_THANKS_MID : FEEDBACK_THANKS_LOW);
        await sendText(msg.from, reply);
      }
      return res.status(200).json({ received: true });
    }

    // ── "I have a problem with my order" (Phase 12) ────────────────────
    if (intent === 'problem') {
      const patch = { needs_call: true, needs_call_reason: 'أبلغ العميل عن مشكلة في الطلب', problem_reported_at: new Date().toISOString() };
      let updated = [];
      const repliedToId = msg.context?.id;
      if (repliedToId) updated = await sbPatchRep(`orders?wa_shipped_msg_id=eq.${encodeURIComponent(repliedToId)}`, patch);
      if (!updated.length) {
        const from = String(msg.from || '').replace(/\D/g, '');
        if (from) {
          const rows = await sbGet('orders?select=id,phone&status=eq.Processing&wa_shipped_sent_at=not.is.null&order=wa_shipped_sent_at.desc&limit=100');
          const match = rows.find(o => waPhone(o.phone) === from);
          if (match) await sbPatchRep(`orders?id=eq.${encodeURIComponent(match.id)}`, patch);
        }
      }
      if (msg.from) await sendText(msg.from, PROBLEM_REPLY);
      return res.status(200).json({ received: true });
    }

    if (intent) {
      const update = intent === 'confirm'
        ? { customer_confirmed: true, confirm_outcome: 'confirmed_button', needs_call: false }
        : { customer_confirmed: false, status: 'Cancelled', confirm_outcome: 'cancelled', needs_call: false };

      // 1) Precise: match the order by the id of the template message we sent.
      let updated = [];
      const repliedToId = msg.context?.id;
      if (repliedToId) updated = await sbPatchRep(`orders?wa_msg_id=eq.${encodeURIComponent(repliedToId)}`, update);

      // 2) Fallback: match by the sender's phone → newest messaged, unresolved order.
      if (!updated.length) {
        const from = String(msg.from || '').replace(/\D/g, '');
        if (from) {
          const rows = await sbGet('orders?select=id,phone,wa_sent_at&customer_confirmed=is.null&wa_sent_at=not.is.null&order=wa_sent_at.desc&limit=100');
          const match = rows.find(o => waPhone(o.phone) === from);
          if (match) await sbPatchRep(`orders?id=eq.${encodeURIComponent(match.id)}`, update);
        }
      }

      // 3) Auto-reply to the customer (the 24h window is open since they just messaged us).
      if (msg.from) await sendText(msg.from, intent === 'confirm' ? CONFIRM_REPLY : CANCEL_REPLY);
    }
  } catch (e) {
    console.error('wa-webhook error:', e.message);
  }
  return res.status(200).json({ received: true });
}
