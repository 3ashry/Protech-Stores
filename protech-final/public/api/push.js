// protech-final/public/api/push.js
// Web Push endpoints. Single function handles multiple actions via ?action=:
//
//   GET  /api/push?action=pubkey      → returns the VAPID public key
//                                       (client uses it to subscribe)
//   POST /api/push?action=subscribe   → body: { subscription }
//                                       upserts the subscription into
//                                       push_subscriptions table
//   GET  /api/push?action=test&key=<CRON_SECRET>
//                                       → fires a test push to every
//                                         subscribed device
//
// The actual push firing for new orders happens from `_push.js`, which
// bosta.js imports. This endpoint is just the subscribe/test surface.
import webpush from 'web-push';
import { sendPushToAll } from './_push.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:mahmoudelashry4597@gmail.com';
const CRON_SECRET = (process.env.CRON_SECRET || '').trim();

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return await new Promise((res) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => { try { res(JSON.parse(s || '{}')); } catch { res({}); } });
  });
}

async function sbInsert(row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?on_conflict=endpoint`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });
  return r;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = (req.query?.action || '').toString();

  // 1) Return the VAPID public key so the client can subscribe.
  if (action === 'pubkey') {
    if (!VAPID_PUBLIC) return res.status(500).json({ error: 'VAPID_PUBLIC_KEY env var not set' });
    return res.status(200).json({ publicKey: VAPID_PUBLIC });
  }

  // 2) Save a new push subscription.
  if (action === 'subscribe' && req.method === 'POST') {
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'DB not configured' });
    const body = await readJson(req);
    const sub = body?.subscription;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Missing subscription.endpoint' });
    const row = {
      endpoint: sub.endpoint,
      subscription: sub,
      created_at: new Date().toISOString(),
    };
    const r = await sbInsert(row);
    if (!r.ok) return res.status(502).json({ error: 'DB write failed', status: r.status, detail: await r.text() });
    return res.status(200).json({ ok: true });
  }

  // 3) Test push — fires a "hello" notification to every subscriber.
  //    Guarded by CRON_SECRET so random visitors can't spam devices.
  if (action === 'test') {
    if (CRON_SECRET) {
      const key = (req.query?.key || '').toString();
      if (key !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
    }
    const result = await sendPushToAll({
      title: '🛒 اختبار الإشعارات',
      body: 'إذا وصلك هذا الإشعار، فإشعارات الطلبات تعمل ✓',
      tag: 'protech-test',
      url: '/',
    });
    return res.status(200).json(result);
  }

  return res.status(400).json({ error: 'Unknown action. Use ?action=pubkey|subscribe|test' });
}
