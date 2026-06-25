// protech-final/api/notify.js
// Vercel Serverless Function — push a "new order" notification via OneSignal.
//
// Secrets come from environment variables (Vercel → Project → Settings →
// Environment Variables). Never hardcode keys here — this file is in source control.
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
// Optional: if set, callers must send header `x-notify-secret: <value>`.
// Recommended when this endpoint is triggered by a Supabase DB webhook.
const NOTIFY_SECRET = process.env.NOTIFY_SECRET;
const NOTIFY_URL = process.env.NOTIFY_TARGET_URL || 'https://protech-stores.vercel.app';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;
  const allow = ALLOWED_ORIGINS.length
    ? (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0])
    : '*';
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-notify-secret');
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  if (!ONESIGNAL_API_KEY || !ONESIGNAL_APP_ID) {
    console.error('notify.js missing env config (ONESIGNAL_API_KEY / ONESIGNAL_APP_ID)');
    return res.status(500).json({ error: 'Server not configured' });
  }

  // Optional shared-secret gate to stop the public from spamming notifications.
  if (NOTIFY_SECRET && req.headers['x-notify-secret'] !== NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body || {};
  let customerName, total, orderCode;
  if (body.record) {
    customerName = body.record.customer_name;
    total = body.record.total;
    orderCode = body.record.code;
  } else {
    customerName = body.customerName;
    total = body.total;
    orderCode = body.orderCode;
  }

  try {
    const response = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Key ' + ONESIGNAL_API_KEY,
      },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        included_segments: ['Total Subscriptions'],
        headings: { en: '🛒 طلب جديد — بروتيك' },
        contents: { en: `طلب جديد من ${customerName} — ${total} جنيه — #${orderCode}` },
        url: NOTIFY_URL,
      })
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
