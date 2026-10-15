// protech-final/public/api/wa-cron.js
// Automatic order-confirmation sender. Runs on a schedule (Vercel Cron, hourly).
// Finds orders placed >= 6 hours ago that have NOT yet had a confirmation message
// sent, and sends the WhatsApp order-confirmation template to each customer.
// The customer's Confirm/Cancel reply is handled by wa-webhook.js, which sets
// customer_confirmed on the order (shown on the dashboard).
//
// Why 6h and not instantly: gives you a window to review/adjust the order first,
// and reaches the customer once, calmly, after they've had time to settle.
//
// Auth: Vercel Cron sends "Authorization: Bearer $CRON_SECRET" automatically when
// CRON_SECRET is set. An external cron (e.g. cron-job.org, needed on the Vercel
// Hobby plan where native cron is daily-only) can instead pass ?key=<CRON_SECRET>.
//
// Env: WA_* (see _wa.js), SUPABASE_URL, SUPABASE_KEY (service_role), CRON_SECRET,
//      optional WA_CONFIRM_DELAY_HOURS (default 6).
import { sendConfirmTemplate, sendReminderTemplate, sendFeedbackTemplate, sendCartRecoveryTemplate, sendShippedTemplate, sendOutForDeliveryTemplate, waConfigured, waPhone } from './_wa.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const CRON_SECRET = (process.env.CRON_SECRET || '').trim();
// Phase-12 escalation timing. After the confirmation goes out with no reply,
// send ONE reminder after WA_REMINDER_HOURS, then flag the order for a phone
// call WA_CALL_AFTER_REMINDER_HOURS after that reminder.
const REMINDER_HOURS = Math.max(1, parseFloat(process.env.WA_REMINDER_HOURS || '3') || 3);
const CALL_AFTER_REMINDER_HOURS = Math.max(1, parseFloat(process.env.WA_CALL_AFTER_REMINDER_HOURS || '6') || 6);
// Hours to wait after an order before sending the confirmation. Production is 6h.
// A leftover sub-1-hour value (used while testing the flow) is IGNORED and falls
// back to 6, so the schedule can never be accidentally left firing minutes after
// checkout. To test the whole chain immediately, hit the endpoint with ?test=1
// (that path ignores the delay entirely) — don't shorten this.
const RAW_DELAY_HOURS = parseFloat(process.env.WA_CONFIRM_DELAY_HOURS || '6');
const DELAY_HOURS = (Number.isFinite(RAW_DELAY_HOURS) && RAW_DELAY_HOURS >= 1) ? RAW_DELAY_HOURS : 6;
// TEST SAFETY VALVE: when set (e.g. "01034482071"), the automation messages ONLY
// this phone number and ignores every other order — so you can safely shorten the
// delay and test end-to-end without messaging real customers. Remove after testing.
const ONLY_PHONE = (process.env.WA_ONLY_PHONE || '').replace(/\D/g, '');

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.message || 'DB read failed');
  return Array.isArray(d) ? d : [];
}
async function sbPatch(id, body) {
  return fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
}

function authorized(req) {
  if (!CRON_SECRET) return true; // no secret set -> allow (you should set one)
  const auth = (req.headers.authorization || '').trim();
  if (auth === `Bearer ${CRON_SECRET}`) return true;
  const key = ((req.query && (req.query.key || req.query.secret)) || '').toString().trim();
  return key === CRON_SECRET;
}

// Helper for ?action=diag. Returns template metadata only (visible in Meta's
// WhatsApp Manager anyway) so it's safe to leave unauthenticated.
async function runDiag(res, WA_TOKEN, WA_PHONE_NUMBER_ID, wabaOverride) {
  const out = { ok: true, phoneNumberId: WA_PHONE_NUMBER_ID };
  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${WA_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier,account_mode,id`,
      { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
    );
    out.phone = await r.json().catch(() => ({ error: 'parse failed' }));
    if (!r.ok && out.phone) out.phone._httpStatus = r.status;
  } catch (e) { out.phone = { error: String(e && e.message || e) }; }
  // Discover the WABA this token can see — try several Meta endpoints in order:
  //   1. /debug_token's granular_scopes.target_ids (if restricted scopes)
  //   2. /{SYSTEM_USER_ID}/assigned_whatsapp_business_accounts (System User tokens)
  //   3. /me/businesses then /{BUSINESS_ID}/owned_whatsapp_business_accounts
  //   4. WA_WABA_ID env var hint (manual fallback)
  let wabaId = (wabaOverride || process.env.WA_WABA_ID || '').trim() || null;
  let userId = null;
  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(WA_TOKEN)}&access_token=${encodeURIComponent(WA_TOKEN)}`
    );
    const d = await r.json().catch(() => ({}));
    out.token = d?.data || d;
    if (!r.ok && out.token) out.token._httpStatus = r.status;
    userId = d?.data?.user_id || null;
    const scopes = Array.isArray(d?.data?.granular_scopes) ? d.data.granular_scopes : [];
    const waScope = scopes.find(s => String(s.scope || '').includes('whatsapp_business'));
    const ids = Array.isArray(waScope?.target_ids) ? waScope.target_ids : [];
    out.wabaCandidates = ids;
    if (!wabaId && ids.length) wabaId = ids[0];
  } catch (e) { out.token = { error: String(e && e.message || e) }; }
  // System User → assigned WABAs.
  if (!wabaId && userId) {
    try {
      const r = await fetch(
        `https://graph.facebook.com/v21.0/${userId}/assigned_whatsapp_business_accounts?fields=id,name&limit=50`,
        { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
      );
      const d = await r.json().catch(() => ({}));
      const arr = Array.isArray(d?.data) ? d.data : [];
      out.assignedWabas = arr;
      if (!r.ok) out.assignedWabas = { _httpStatus: r.status, data: d };
      if (!wabaId && arr.length) wabaId = arr[0].id;
    } catch (e) { out.assignedWabas = { error: String(e && e.message || e) }; }
  }
  // Me → businesses → owned WABAs.
  if (!wabaId) {
    try {
      const r = await fetch(
        `https://graph.facebook.com/v21.0/me/businesses?fields=id,name&limit=20`,
        { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
      );
      const d = await r.json().catch(() => ({}));
      const biz = Array.isArray(d?.data) ? d.data : [];
      out.businesses = biz;
      if (!r.ok) out.businesses = { _httpStatus: r.status, data: d };
      for (const b of biz) {
        if (wabaId) break;
        try {
          const rr = await fetch(
            `https://graph.facebook.com/v21.0/${b.id}/owned_whatsapp_business_accounts?fields=id,name&limit=20`,
            { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
          );
          const dd = await rr.json().catch(() => ({}));
          const arr = Array.isArray(dd?.data) ? dd.data : [];
          out.ownedWabas = (out.ownedWabas || []).concat(arr);
          if (!wabaId && arr.length) wabaId = arr[0].id;
        } catch (_) {}
      }
    } catch (e) { out.businesses = { error: String(e && e.message || e) }; }
  }
  out.wabaIdUsed = wabaId;
  if (wabaId) {
    // Probe the WABA itself first — tells us whether the token even has access.
    try {
      const r = await fetch(
        `https://graph.facebook.com/v21.0/${wabaId}?fields=id,name,timezone_id,message_template_namespace,account_review_status,business_verification_status`,
        { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
      );
      const d = await r.json().catch(() => ({}));
      out.wabaProbe = { httpStatus: r.status, body: d };
    } catch (e) { out.wabaProbe = { error: String(e && e.message || e) }; }
    // Template listing — capture status + raw body so error payloads aren't swallowed.
    try {
      const r = await fetch(
        `https://graph.facebook.com/v21.0/${wabaId}/message_templates?fields=name,language,status,category,components&limit=100`,
        { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
      );
      const d = await r.json().catch(() => ({}));
      out.templatesRaw = { httpStatus: r.status, body: d };
      const all = Array.isArray(d.data) ? d.data : [];
      out.templates = all.filter(t => String(t.name || '').startsWith('order_')).map(t => {
        const body = (t.components || []).find(c => c.type === 'BODY');
        const text = (body && body.text) || '';
        const nums = (text.match(/\{\{(\d+)\}\}/g) || []).map(s => parseInt(s.replace(/[^0-9]/g, ''), 10) || 0);
        const maxVar = nums.reduce((m, n) => n > m ? n : m, 0);
        return { name: t.name, language: t.language, status: t.status, category: t.category, bodyParamCount: maxVar, bodyPreview: text.slice(0, 300) };
      });
      out.allTemplateNames = all.map(t => `${t.name} (${t.language}) [${t.status}]`).sort();
    } catch (e) { out.templates = { error: String(e && e.message || e) }; }
  }
  return res.status(200).json(out);
}

export default async function handler(req, res) {
  // Diagnostic view runs BEFORE the auth check — it returns only template
  // metadata that is already visible in Meta's WhatsApp Manager (no tokens,
  // no secrets, no customer data), so a secret isn't needed to see what WABA
  // the current connection points at and which templates are stored there.
  // Call: GET /api/wa-cron?action=diag
  if (req.query && String(req.query.action || '') === 'diag') {
    const WA_TOKEN = process.env.WA_TOKEN;
    const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
    if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) {
      return res.status(500).json({ error: 'WA_TOKEN or WA_PHONE_NUMBER_ID not set' });
    }
    // Direct template lookup — ?template=<id> returns the exact definition Meta
    // serves at send time, bypassing WABA discovery entirely.
    const tplId = req.query && (req.query.template || req.query.template_id);
    if (tplId) {
      try {
        const r = await fetch(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(String(tplId))}?fields=name,language,status,category,components,quality_score,previous_category`,
          { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
        );
        const d = await r.json().catch(() => ({}));
        const body = Array.isArray(d.components) ? d.components.find(c => c.type === 'BODY') : null;
        const text = (body && body.text) || '';
        const nums = (text.match(/\{\{(\d+)\}\}/g) || []).map(s => parseInt(s.replace(/[^0-9]/g, ''), 10) || 0);
        const maxVar = nums.reduce((m, n) => n > m ? n : m, 0);
        return res.status(200).json({ ok: r.ok, httpStatus: r.status, template: d, bodyParamCount: maxVar, bodyText: text });
      } catch (e) {
        return res.status(500).json({ error: String(e && e.message || e) });
      }
    }
    // Probe — ?probe=6 sends the order_confirm template with placeholder values
    // P1..PN to the phone of the most recent order (created in the last 2h, so
    // it can only ever reach the owner's own test order). Whatever arrives on
    // WhatsApp shows exactly which body Meta has stored and where each {{N}} sits.
    if (req.query.probe) {
      const n = Math.min(10, Math.max(1, parseInt(req.query.probe, 10) || 6));
      const name = String(req.query.name || process.env.WA_TEMPLATE_NAME || 'order_confirm');
      if (!/^order_[a-z0-9_]+$/.test(name)) return res.status(400).json({ error: 'name must be an order_* template' });
      const since = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
      let rows = [];
      try { rows = await sbGet(`orders?select=code,phone,created_at&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=1`); } catch (_) {}
      const o = rows[0];
      if (!o || !o.phone) return res.status(400).json({ error: 'No order in the last 2 hours — place a test order first.' });
      const lang = String(process.env.WA_TEMPLATE_LANG || 'ar');
      const params = Array.from({ length: n }, (_, i) => ({ type: 'text', text: `P${i + 1}` }));
      const r = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: waPhone(o.phone),
          type: 'template',
          template: { name, language: { code: lang }, components: [{ type: 'body', parameters: params }] },
        }),
      });
      const d = await r.json().catch(() => null);
      return res.status(200).json({ sentTo: o.code, template: name, language: lang, paramsSent: n, httpStatus: r.status, meta: d });
    }
    const wabaOverride = req.query && (req.query.waba || req.query.waba_id);
    return runDiag(res, WA_TOKEN, WA_PHONE_NUMBER_ID, wabaOverride ? String(wabaOverride) : null);
  }

  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'DB not configured' });
  if (!waConfigured()) return res.status(500).json({ error: 'WhatsApp not configured' });


  // ?test=1 fires immediately: ignores the 6h wait and only messages the single
  // newest eligible order, so you can confirm the whole chain right after ordering.
  const test = !!(req.query && (req.query.test || req.query.now));
  const now = Date.now();
  const cutoff = new Date(now - (test ? 0 : DELAY_HOURS * 3600 * 1000)).toISOString();
  const floor = new Date(now - 72 * 3600 * 1000).toISOString(); // skip orders older than 3 days

  try {
    // Old enough, never sent, not yet resolved, still in an early state, has a phone.
    const qparts = [
      'select=id,code,phone,customer_name,total,est_shipping,allow_open,ship_code,products,address,created_at,status',
      `created_at=lte.${encodeURIComponent(cutoff)}`,
      `created_at=gte.${encodeURIComponent(floor)}`,
      'wa_sent_at=is.null',
      'customer_confirmed=is.null',
      'status=not.in.(Cancelled,Returned,Delivered)',
      'phone=not.is.null',
    ];
    if (ONLY_PHONE) qparts.push(`phone=eq.${encodeURIComponent(ONLY_PHONE)}`);
    qparts.push(`order=created_at.${test ? 'desc' : 'asc'}`, `limit=${test ? 1 : 50}`);
    const q = qparts.join('&');
    const orders = await sbGet(`orders?${q}`);

    const sent = [], failed = [], waitingShipCode = [];
    for (const o of orders) {
      // Phase 12: the "order received" confirmation goes out on time even before
      // Bosta assigns a ship code — the template shows a "سيتم إرساله قريباً"
      // placeholder, and the real tracking code arrives later in the separate
      // "handed to Bosta / shipped" message.
      const r = await sendConfirmTemplate(o);
      if (r.ok) {
        // Mark sent so the next run doesn't message the same order again.
        await sbPatch(o.id, { wa_msg_id: r.msgId, wa_sent_at: new Date().toISOString() });
        sent.push({ code: o.code, msgId: r.msgId });
      } else {
        failed.push({ code: o.code, error: r.error });
      }
    }
    // ─────────────────────────────────────────────────────────────────
    //  FEEDBACK PASS — for orders now Delivered, ask the customer to rate.
    //  Fired ASAP after the delivery status flips. `wa_feedback_sent_at`
    //  prevents re-sending. Phone-lock (WA_ONLY_PHONE) still respected.
    // ─────────────────────────────────────────────────────────────────
    const fbParts = [
      'select=id,code,phone,customer_name',
      'status=eq.Delivered',
      'wa_feedback_sent_at=is.null',
      'phone=not.is.null',
    ];
    if (ONLY_PHONE) fbParts.push(`phone=eq.${encodeURIComponent(ONLY_PHONE)}`);
    fbParts.push('order=updated_at.desc', 'limit=100');
    const fbOrders = await sbGet(`orders?${fbParts.join('&')}`);
    const fbSent = [], fbFailed = [];
    for (const o of fbOrders) {
      const r = await sendFeedbackTemplate(o);
      if (r.ok) {
        await sbPatch(o.id, { wa_feedback_sent_at: new Date().toISOString(), wa_feedback_msg_id: r.msgId });
        fbSent.push({ code: o.code, msgId: r.msgId });
      } else {
        fbFailed.push({ code: o.code, error: r.error });
      }
    }

    // ─────────────────────────────────────────────────────────────────
    //  ABANDONED-CART PASS — nudge customers who started an order but
    //  never finished. Fires 3h after the cart went idle. Sends the
    //  cart-recovery template ONCE (wa_reminder_sent_at prevents dupes).
    //  Cap: skip carts older than 3 days so we don't message stale ones.
    // ─────────────────────────────────────────────────────────────────
    const cartCutoff = new Date(now - (test ? 0 : 3 * 3600 * 1000)).toISOString();
    const cartFloor  = new Date(now - 72 * 3600 * 1000).toISOString();
    const cartParts = [
      'select=id,name,phone,items,updated_at,created_at,status,wa_reminder_sent_at',
      'status=eq.open',
      'wa_reminder_sent_at=is.null',
      'phone=not.is.null',
      `updated_at=lte.${encodeURIComponent(cartCutoff)}`,
      `updated_at=gte.${encodeURIComponent(cartFloor)}`,
    ];
    if (ONLY_PHONE) cartParts.push(`phone=eq.${encodeURIComponent(ONLY_PHONE)}`);
    cartParts.push('order=updated_at.desc', `limit=${test ? 1 : 50}`);
    let cartCandidates = [];
    try { cartCandidates = await sbGet(`abandoned_carts?${cartParts.join('&')}`); } catch (e) { console.warn('abandoned_carts query failed:', e.message); }
    const cartSent = [], cartFailed = [];
    for (const c of cartCandidates) {
      try {
        const r = await sendCartRecoveryTemplate(c);
        if (r.ok) {
          // Mark reminder as sent so we don't message this cart again.
          await fetch(`${SUPABASE_URL}/rest/v1/abandoned_carts?id=eq.${encodeURIComponent(c.id)}`, {
            method: 'PATCH',
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ wa_reminder_sent_at: new Date().toISOString(), wa_reminder_msg_id: r.msgId }),
          }).catch(() => {});
          cartSent.push({ id: c.id, name: c.name, msgId: r.msgId });
        } else {
          cartFailed.push({ id: c.id, name: c.name, error: r.error });
        }
      } catch (e) { cartFailed.push({ id: c.id, name: c.name, error: e.message }); }
    }

    // PREPARED PASS removed — the new flow goes confirm → handed-to-Bosta →
    // out-for-delivery → delivered, with no separate "order packed" message.
    const prepOrders = [], prepSent = [], prepFailed = [];

    // ─────────────────────────────────────────────────────────────────
    //  SHIPPED PASS — handed to Bosta (ship_code assigned): order_shipped
    //  (name, order code, tracking, amount) + a static call button only.
    //  Not gated to Processing — the status may already have flipped to
    //  In Transit by the time the cron runs; wa_shipped_sent_at dedupes.
    // ─────────────────────────────────────────────────────────────────
    const shipParts = [
      'select=id,code,phone,customer_name,ship_code,total',
      'ship_code=not.is.null',
      'wa_shipped_sent_at=is.null',
      'status=not.in.(Delivered,Returned,Cancelled)',
      'phone=not.is.null',
      `created_at=gte.${encodeURIComponent(floor)}`,
    ];
    if (ONLY_PHONE) shipParts.push(`phone=eq.${encodeURIComponent(ONLY_PHONE)}`);
    shipParts.push('order=created_at.desc', `limit=${test ? 1 : 50}`);
    const shipOrders = await sbGet(`orders?${shipParts.join('&')}`);
    const shipSent = [], shipFailed = [];
    for (const o of shipOrders) {
      if (!(o.ship_code && String(o.ship_code).trim())) continue;
      const r = await sendShippedTemplate(o);
      if (r.ok) { await sbPatch(o.id, { wa_shipped_sent_at: new Date().toISOString(), wa_shipped_msg_id: r.msgId }); shipSent.push({ code: o.code, msgId: r.msgId }); }
      else shipFailed.push({ code: o.code, error: r.error });
    }

    // ─────────────────────────────────────────────────────────────────
    //  OUT-FOR-DELIVERY PASS — Bosta marked the parcel heading to the
    //  customer (status → "Heading to Customer"): order_out_for_delivery
    //  (name, tracking, amount) + a static call button. Sent once.
    // ─────────────────────────────────────────────────────────────────
    const odParts = [
      'select=id,code,phone,customer_name,ship_code,total',
      `status=eq.${encodeURIComponent('Heading to Customer')}`,
      'wa_outdelivery_sent_at=is.null',
      'phone=not.is.null',
      `created_at=gte.${encodeURIComponent(floor)}`,
    ];
    if (ONLY_PHONE) odParts.push(`phone=eq.${encodeURIComponent(ONLY_PHONE)}`);
    odParts.push('order=created_at.desc', `limit=${test ? 1 : 50}`);
    const odOrders = await sbGet(`orders?${odParts.join('&')}`);
    const odSent = [], odFailed = [];
    for (const o of odOrders) {
      const r = await sendOutForDeliveryTemplate(o);
      if (r.ok) { await sbPatch(o.id, { wa_outdelivery_sent_at: new Date().toISOString(), wa_outdelivery_msg_id: r.msgId }); odSent.push({ code: o.code, msgId: r.msgId }); }
      else odFailed.push({ code: o.code, error: r.error });
    }

    // ─────────────────────────────────────────────────────────────────
    //  REMINDER + ESCALATION (Phase 12) — the customer never answered the
    //  confirmation. Stage 1: resend it once after REMINDER_HOURS. Stage 2:
    //  CALL_AFTER_REMINDER_HOURS later, flag the order for a phone call
    //  (needs_call) and record the outcome as "no_answer".
    // ─────────────────────────────────────────────────────────────────
    const reminderCutoff = new Date(now - (test ? 0 : REMINDER_HOURS * 3600 * 1000)).toISOString();
    const remParts = [
      'select=id,code,phone,customer_name,total,est_shipping,allow_open,ship_code,products,address',
      'wa_sent_at=not.is.null',
      `wa_sent_at=lte.${encodeURIComponent(reminderCutoff)}`,
      `wa_sent_at=gte.${encodeURIComponent(floor)}`,
      'customer_confirmed=is.null',
      'wa_confirm_reminder_at=is.null',
      'status=eq.Processing',
      'phone=not.is.null',
    ];
    if (ONLY_PHONE) remParts.push(`phone=eq.${encodeURIComponent(ONLY_PHONE)}`);
    remParts.push('order=wa_sent_at.asc', `limit=${test ? 1 : 50}`);
    const remOrders = await sbGet(`orders?${remParts.join('&')}`);
    const remSent = [], remFailed = [];
    for (const o of remOrders) {
      // Dedicated reminder template ("طلبك لسه مستني تأكيدك") with the same
      // confirm/cancel buttons. Store its id so a tap on it maps to this order.
      const r = await sendReminderTemplate(o);
      if (r.ok) { await sbPatch(o.id, { wa_confirm_reminder_at: new Date().toISOString(), wa_confirm_reminder_msg_id: r.msgId }); remSent.push({ code: o.code, msgId: r.msgId }); }
      else remFailed.push({ code: o.code, error: r.error });
    }
    const callCutoff = new Date(now - (test ? 0 : CALL_AFTER_REMINDER_HOURS * 3600 * 1000)).toISOString();
    const callParts = [
      'select=id,code',
      'wa_confirm_reminder_at=not.is.null',
      `wa_confirm_reminder_at=lte.${encodeURIComponent(callCutoff)}`,
      'customer_confirmed=is.null',
      'needs_call=is.false',
      'status=eq.Processing',
    ];
    if (ONLY_PHONE) callParts.push(`phone=eq.${encodeURIComponent(ONLY_PHONE)}`);
    callParts.push('order=wa_confirm_reminder_at.asc', 'limit=100');
    const callOrders = await sbGet(`orders?${callParts.join('&')}`);
    const flaggedForCall = [];
    for (const o of callOrders) {
      await sbPatch(o.id, { needs_call: true, needs_call_reason: 'لم يرد على رسالة التأكيد', confirm_outcome: 'no_answer' });
      flaggedForCall.push(o.code);
    }

    const result = { ok: true, test, onlyPhone: ONLY_PHONE || null, delayHours: DELAY_HOURS,
      confirm: { candidates: orders.length, sent: sent.length, failed: failed.length, waitingShipCode: waitingShipCode.length,
        details: { sent, failed: failed.slice(0, 5), waitingShipCode: waitingShipCode.slice(0, 5) } },
      prepared: { candidates: prepOrders.length, sent: prepSent.length, failed: prepFailed.length,
        details: { sent: prepSent.slice(0, 10), failed: prepFailed.slice(0, 5) } },
      shipped: { candidates: shipOrders.length, sent: shipSent.length, failed: shipFailed.length,
        details: { sent: shipSent.slice(0, 10), failed: shipFailed.slice(0, 5) } },
      outForDelivery: { candidates: odOrders.length, sent: odSent.length, failed: odFailed.length,
        details: { sent: odSent.slice(0, 10), failed: odFailed.slice(0, 5) } },
      escalation: { reminders: remSent.length, remindersFailed: remFailed.length, flaggedForCall: flaggedForCall.length,
        details: { flagged: flaggedForCall.slice(0, 10), failed: remFailed.slice(0, 5) } },
      feedback: { candidates: fbOrders.length, sent: fbSent.length, failed: fbFailed.length,
        details: { sent: fbSent.slice(0, 10), failed: fbFailed.slice(0, 5) } },
      cartRecovery: { candidates: cartCandidates.length, sent: cartSent.length, failed: cartFailed.length,
        details: { sent: cartSent.slice(0, 10), failed: cartFailed.slice(0, 5) } },
    };
    console.log('wa-cron', JSON.stringify(result));
    return res.status(200).json(result);
  } catch (e) {
    console.error('wa-cron error', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// redeploy trigger
