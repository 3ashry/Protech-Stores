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
import { sendConfirmTemplate, waConfigured } from './_wa.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const DELAY_HOURS = parseFloat(process.env.WA_CONFIRM_DELAY_HOURS || '6');

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
  const auth = req.headers.authorization || '';
  if (auth === `Bearer ${CRON_SECRET}`) return true;
  const key = (req.query && (req.query.key || req.query.secret)) || '';
  return key === CRON_SECRET;
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'DB not configured' });
  if (!waConfigured()) return res.status(500).json({ error: 'WhatsApp not configured' });

  const now = Date.now();
  const cutoff = new Date(now - DELAY_HOURS * 3600 * 1000).toISOString();
  const floor = new Date(now - 72 * 3600 * 1000).toISOString(); // skip orders older than 3 days

  try {
    // Old enough, never sent, not yet resolved, still in an early state, has a phone.
    const q = [
      'select=id,code,phone,customer_name,total,est_shipping,allow_open,ship_code,products,created_at,status',
      `created_at=lte.${encodeURIComponent(cutoff)}`,
      `created_at=gte.${encodeURIComponent(floor)}`,
      'wa_sent_at=is.null',
      'customer_confirmed=is.null',
      'status=not.in.(Cancelled,Returned,Delivered)',
      'phone=not.is.null',
      'order=created_at.asc',
      'limit=50',
    ].join('&');
    const orders = await sbGet(`orders?${q}`);

    const sent = [], failed = [];
    for (const o of orders) {
      const r = await sendConfirmTemplate(o);
      if (r.ok) {
        // Mark sent so the next run doesn't message the same order again.
        await sbPatch(o.id, { wa_msg_id: r.msgId, wa_sent_at: new Date().toISOString() });
        sent.push({ code: o.code, msgId: r.msgId });
      } else {
        failed.push({ code: o.code, error: r.error });
      }
    }
    const result = { ok: true, candidates: orders.length, sent: sent.length, failed: failed.length, details: { sent, failed: failed.slice(0, 5) } };
    console.log('wa-cron', JSON.stringify(result));
    return res.status(200).json(result);
  } catch (e) {
    console.error('wa-cron error', e.message);
    return res.status(500).json({ error: e.message });
  }
}
