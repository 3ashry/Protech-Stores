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
import { waPhone, sendText, sendButtons, sendConfirmTemplate, waConfigured } from './_wa.js';

// Auto-replies sent back to the customer after they confirm / cancel.
const CONFIRM_REPLY = 'شكراً لتأكيد طلبك ✅\nهنجهّز طلبك ونشحنه لك في أسرع وقت، وهنبلّغك أول ما يتسلّم لشركة الشحن 🚚';
// After a cancel we ask WHY, with quick-reply reasons (buttons below).
const CANCEL_REPLY = 'تم إلغاء الطلب 🙏 ممكن تقولنا السبب عشان نحسّن خدمتنا؟';
const CANCEL_REASON_BUTTONS = [
  { id: 'CANCEL_REASON_PRICE',   title: 'السعر مرتفع' },
  { id: 'CANCEL_REASON_MIND',    title: 'غيّرت رأيي' },
  { id: 'CANCEL_REASON_MISTAKE', title: 'طلبت بالغلط' },
];
const CANCEL_REASONS = {
  CANCEL_REASON_PRICE:   'السعر مرتفع',
  CANCEL_REASON_MIND:    'غيّرت رأيي',
  CANCEL_REASON_MISTAKE: 'طلبت بالغلط',
};
const CANCEL_REASON_THANKS = 'شكراً لوقتك وصراحتك 🙏 هناخد ملاحظتك في الاعتبار عشان نحسّن خدمتنا.';
// Phase 12 — reply after the customer taps "I have a problem with my order".
const PROBLEM_REPLY = 'تمام، سجّلنا إن عندك مشكلة في الطلب ✅ هنتواصل معاك في أقرب وقت على نفس الرقم.';
// Auto-reply after a rating tap on the feedback template.
const FEEDBACK_THANKS_HIGH = 'شكراً جداً لتقييمك 🌟\nيسعدنا خدمتك دائماً، ولو محتاج أي حاجة إحنا معاك.';
const FEEDBACK_THANKS_MID  = 'شكراً على تقييمك 🙏\nلو عندك أي ملاحظة تحب تشاركنا بيها، اكتبها هنا في أي وقت.';
// Low rating → ask the customer to WRITE what went wrong. The next text they
// send is captured as the complaint (awaiting_feedback_note flag).
const FEEDBACK_THANKS_LOW  = 'نأسف إن التجربة ماكانتش زي ما تتمنى 🙏\nممكن تكتبلنا هنا إيه اللي محتاج يتحسّن؟ رأيك هيساعدنا نبقى أحسن.';
// Sent after the customer types their complaint following a low rating.
const FEEDBACK_NOTE_THANKS = 'شكراً جداً على ملاحظتك 🙏 وصلتنا وهنشتغل عليها عشان نحسّن تجربتك المرة الجاية.';

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

// Put an order's quantities back on its products (by product id, the same
// way /api/bosta took them at checkout). Best-effort.
async function restoreStock(products) {
  for (const it of (Array.isArray(products) ? products : [])) {
    if (!it || !it.id) continue;
    try {
      const rows = await sbGet(`products?id=eq.${encodeURIComponent(it.id)}&select=id,qty`);
      if (!rows.length) continue;
      const qty = (parseInt(rows[0].qty) || 0) + (parseInt(it.qty) || 0);
      await sbPatchRep(`products?id=eq.${encodeURIComponent(it.id)}`, { qty });
    } catch (e) { console.warn('restoreStock failed:', e.message); }
  }
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
    // IDs only (no message content): entry.id is the WhatsApp Business Account
    // the event came from — lets us identify which account owns the sender.
    console.log('wa-webhook event', JSON.stringify({
      waba: entry?.id || null,
      phoneNumberId: change?.metadata?.phone_number_id || null,
      field: entry?.changes?.[0]?.field || null,
      kind: change?.messages ? 'message' : (change?.statuses ? 'status' : 'other'),
    }));

    // ── Delivery-status events ─────────────────────────────────────────
    // A message that FAILED to deliver usually means that number isn't on
    // WhatsApp (or blocked us). The customer gave two numbers, so: if the
    // FIRST confirmation fails, resend it to the SECOND number and remember
    // that one (wa_phone) for every later message. If the second also fails
    // — or a later message fails — flag the order for a phone call.
    const statusEvt = change?.statuses?.[0];
    // Meta's verdict on each sent message (no phone numbers or content), so a
    // failure reason survives even when we fall back to the second number.
    if (statusEvt) {
      const err = statusEvt.errors?.[0];
      console.log('wa-webhook status', JSON.stringify({
        msgId: statusEvt.id || null,
        status: statusEvt.status || null,
        category: statusEvt.pricing?.category || null,
        errorCode: err?.code || null,
        errorTitle: err?.title || null,
        errorDetails: err?.error_data?.details || err?.message || null,
      }));
    }
    if (statusEvt && (statusEvt.status === 'failed' || statusEvt.status === 'undelivered') && SUPABASE_URL && SUPABASE_KEY) {
      const failedId = statusEvt.id;
      const reason = statusEvt.errors?.[0]?.title || statusEvt.errors?.[0]?.message || statusEvt.status;
      if (failedId) {
        const cols = ['wa_msg_id', 'wa_confirm_reminder_msg_id', 'wa_shipped_msg_id', 'wa_outdelivery_msg_id', 'wa_feedback_msg_id'];
        let order = null, matchedCol = null;
        for (const col of cols) {
          const rows = await sbGet(`orders?${col}=eq.${encodeURIComponent(failedId)}&select=id,code,phone,second_phone,wa_phone,customer_name,products,total,address,allow_open,ship_code&limit=1`);
          if (rows.length) { order = rows[0]; matchedCol = col; break; }
        }
        if (order) {
          const main = String(order.phone || '').replace(/\s+/g, '');
          const second = String(order.second_phone || '').replace(/\s+/g, '');
          // Only retry on the FIRST confirmation, only if a distinct second
          // number exists, and only if we haven't already switched numbers.
          const canFallback = matchedCol === 'wa_msg_id' && second && second !== main && !order.wa_phone && waConfigured();
          if (canFallback) {
            const sent = await sendConfirmTemplate({ ...order, wa_phone: order.second_phone });
            if (sent?.ok) {
              await sbPatchRep(`orders?id=eq.${encodeURIComponent(order.id)}`,
                { wa_phone: order.second_phone, wa_msg_id: sent.msgId, wa_sent_at: new Date().toISOString(), wa_delivery_failed: false });
            } else {
              await sbPatchRep(`orders?id=eq.${encodeURIComponent(order.id)}`,
                { wa_delivery_failed: true, needs_call: true, needs_call_reason: 'الرقمين مش على واتساب — محتاج اتصال' });
            }
          } else {
            await sbPatchRep(`orders?id=eq.${encodeURIComponent(order.id)}`,
              { wa_delivery_failed: true, needs_call: true, needs_call_reason: 'فشل توصيل رسالة واتساب: ' + reason });
          }
        }
      }
      return res.status(200).json({ received: true });
    }

    const msg = change?.messages?.[0];
    if (!msg || !SUPABASE_URL || !SUPABASE_KEY) return res.status(200).json({ received: true });

    // ── Complaint capture ──────────────────────────────────────────────
    // If this customer just gave a low rating and we asked them to describe
    // the problem, their NEXT free-text message IS that description. Capture
    // it before any other intent parsing so its wording can't be mistaken
    // for a confirm/cancel/problem command.
    if (msg.type === 'text') {
      const from = String(msg.from || '').replace(/\D/g, '');
      const body = (msg.text?.body || '').trim();
      if (from && body) {
        const waiting = await sbGet('orders?select=id,phone&awaiting_feedback_note=is.true&order=feedback_at.desc&limit=50');
        const match = waiting.find(o => waPhone(o.phone) === from);
        if (match) {
          await sbPatchRep(`orders?id=eq.${encodeURIComponent(match.id)}`,
            { feedback_note: body, feedback_note_at: new Date().toISOString(), awaiting_feedback_note: false });
          await sendText(msg.from, FEEDBACK_NOTE_THANKS);
          return res.status(200).json({ received: true });
        }
      }
    }

    // Work out the customer's intent from a button tap OR a typed message.
    // Intent is one of: 'confirm' | 'cancel' | 'rating' (with .rating = 5/3/1).
    let intent = null;
    let rating = null;
    let cancelReasonId = null;
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
      // Cancel-reason taps are checked FIRST — "طلبت بالغلط" contains "غلط",
      // which would otherwise be misread as a "problem" by the regex below.
      if (id.startsWith('CANCEL_REASON_')) { intent = 'cancel_reason'; cancelReasonId = id; }
      else if (r != null) { intent = 'rating'; rating = r; }
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
      // Low rating → flag the order so the customer's next text is saved as the
      // written complaint (handled by the complaint-capture block above).
      if (rating === 1) patch.awaiting_feedback_note = true;
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

    // ── Cancel-reason tap (follow-up buttons after a cancellation) ──────
    if (intent === 'cancel_reason') {
      const reasonText = CANCEL_REASONS[cancelReasonId] || cancelReasonId;
      const patch = { cancel_reason: reasonText, cancel_reason_at: new Date().toISOString() };
      // Match the most recent cancelled order from this phone that has no
      // reason yet (the customer just cancelled it moments ago).
      const from = String(msg.from || '').replace(/\D/g, '');
      if (from) {
        const rows = await sbGet('orders?select=id,phone&status=eq.Cancelled&cancel_reason=is.null&order=created_at.desc&limit=50');
        const match = rows.find(o => waPhone(o.phone) === from);
        if (match) await sbPatchRep(`orders?id=eq.${encodeURIComponent(match.id)}`, patch);
      }
      if (msg.from) await sendText(msg.from, CANCEL_REASON_THANKS);
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
      // 1) Precise: find the order by the id of the template message we sent
      //    (the tap may be on the 3h REMINDER rather than the first one).
      const sel = 'id,phone,wa_phone,status,products,warehouse_confirmed,sent_to_picker_at,picker_prepared_at';
      let order = null;
      const repliedToId = msg.context?.id;
      if (repliedToId) {
        for (const col of ['wa_msg_id', 'wa_confirm_reminder_msg_id']) {
          const rows = await sbGet(`orders?${col}=eq.${encodeURIComponent(repliedToId)}&select=${sel}&limit=1`);
          if (rows.length) { order = rows[0]; break; }
        }
      }
      // 2) Fallback: match by the sender's phone → newest messaged, unresolved order.
      if (!order) {
        const from = String(msg.from || '').replace(/\D/g, '');
        if (from) {
          const rows = await sbGet(`orders?select=${sel}&customer_confirmed=is.null&wa_sent_at=not.is.null&order=wa_sent_at.desc&limit=100`);
          order = rows.find(o => waPhone(o.wa_phone || o.phone) === from) || null;
        }
      }

      if (order) {
        const now = new Date().toISOString();
        const byId = `orders?id=eq.${encodeURIComponent(order.id)}`;
        if (intent === 'confirm') {
          // A confirmed order goes straight to the preparation center.
          const patch = { customer_confirmed: true, confirm_outcome: 'confirmed_button', needs_call: false };
          if (order.status === 'Processing' && !order.sent_to_picker_at) patch.sent_to_picker_at = now;
          await sbPatchRep(byId, patch);
        } else if (order.status !== 'Cancelled') {
          // Not prepared yet → just "failed before preparing" (it drops off
          // the prep queue). Already prepared → flag it so the prep center
          // gets a blocking popup telling them to cancel it.
          const prepared = !!order.picker_prepared_at;
          const patch = {
            customer_confirmed: false, status: 'Cancelled', confirm_outcome: 'cancelled', needs_call: false,
            cancel_stage: prepared ? 'after_prep' : 'before_prep',
          };
          if (prepared) { patch.post_prep_cancel_at = now; patch.post_prep_cancel_ack_at = null; }
          await sbPatchRep(byId, patch);
          // Stock was taken at checkout; give it back while the goods are
          // still with us (once Bosta has it, it comes back as a return).
          if (order.status === 'Processing' && !order.warehouse_confirmed) await restoreStock(order.products);
        }
      }

      // 3) Auto-reply to the customer (the 24h window is open since they just
      //    messaged us). Confirm → a simple thank-you; Cancel → ask why, with
      //    three quick-reply reasons the next webhook hit records.
      if (msg.from) {
        if (intent === 'confirm') {
          await sendText(msg.from, CONFIRM_REPLY);
        } else {
          const sent = await sendButtons(msg.from, CANCEL_REPLY, CANCEL_REASON_BUTTONS);
          if (!sent.ok) await sendText(msg.from, CANCEL_REPLY); // fallback to plain text
        }
      }
    }
  } catch (e) {
    console.error('wa-webhook error:', e.message);
  }
  return res.status(200).json({ received: true });
}
