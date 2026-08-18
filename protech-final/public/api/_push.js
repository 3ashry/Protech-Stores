// protech-final/public/api/_push.js
// Web Push sending helper. Called by:
//   - bosta.js  → sendPushForOrder(order)  (fires on every new order)
//   - push.js   → sendPushToAll({title, body, ...})  (test-fire from admin)
// Underscore prefix keeps this out of Vercel's function router (private module).
import webpush from 'web-push';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:mahmoudelashry4597@gmail.com';

let vapidReady = false;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  vapidReady = true;
}

export function pushConfigured() {
  return vapidReady && !!SUPABASE_URL && !!SUPABASE_KEY;
}

async function fetchSubs() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=id,subscription,endpoint`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) return [];
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

// Bosta sometimes returns 404/410 for a subscription that the user
// uninstalled — delete those so we don't keep retrying.
async function deleteSub(endpoint) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'return=minimal' },
    });
  } catch (_) {}
}

// Payload shape the service worker's `push` handler in /sw.js expects.
export async function sendPushToAll({ title, body, url, tag, orderCode } = {}) {
  if (!pushConfigured()) return { ok: false, error: 'Push not configured', sent: 0, failed: 0 };
  const subs = await fetchSubs();
  if (!subs.length) return { ok: true, sent: 0, failed: 0, note: 'No subscribers' };
  const payload = JSON.stringify({
    title: title || '🛒 طلب جديد',
    body: body || 'اضغط لعرض الطلب في لوحة التحكم.',
    url: url || '/',
    tag: tag || 'protech-order',
    orderCode: orderCode || null,
  });
  let sent = 0, failed = 0;
  await Promise.all(subs.map(async (row) => {
    try {
      await webpush.sendNotification(row.subscription, payload, { TTL: 60 * 60 });
      sent++;
    } catch (e) {
      failed++;
      const sc = e?.statusCode;
      if (sc === 404 || sc === 410) await deleteSub(row.endpoint);
    }
  }));
  return { ok: true, sent, failed, subscribers: subs.length };
}

// Convenience for the order-created hook in bosta.js. Formats a nice body.
export async function sendPushForOrder(order) {
  if (!order) return { ok: false, error: 'No order' };
  const total = parseFloat(order.total || 0);
  const totalTxt = isFinite(total) ? total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
  const parts = [
    order.customer_name || 'عميل',
    order.city || '',
    totalTxt ? `${totalTxt} ج.م` : '',
  ].filter(Boolean);
  return sendPushToAll({
    title: `🛒 طلب جديد — ${order.code || ''}`.trim(),
    body: parts.join(' — '),
    tag: `order-${order.id || order.code}`,
    orderCode: order.code || null,
    url: '/',
  });
}
