// protech-final/public/api/wa-subscribe.js
// One-off helper: subscribes THIS app to a WhatsApp Business Account (WABA) so
// inbound customer replies are delivered to /api/wa-webhook. Sending works without
// this, but RECEIVING requires the WABA to be subscribed to the app.
//
// Usage (GET or POST):
//   /api/wa-subscribe?key=<CRON_SECRET>&waba=<WABA_ID>
// It POSTs {WABA}/subscribed_apps with WA_TOKEN, then GETs it back to confirm.
const WA_TOKEN = process.env.WA_TOKEN || '';
const CRON_SECRET = (process.env.CRON_SECRET || '').trim();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const key = ((req.query && (req.query.key || req.query.secret)) || '').toString().trim();
  if (CRON_SECRET && key !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  if (!WA_TOKEN) return res.status(500).json({ error: 'WA_TOKEN not set' });

  const waba = ((req.query && req.query.waba) || '').toString().trim();
  if (!waba) return res.status(400).json({ error: 'Pass ?waba=<WhatsApp Business Account ID>' });

  const base = `https://graph.facebook.com/v21.0/${encodeURIComponent(waba)}/subscribed_apps`;
  try {
    const post = await fetch(base, { method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}` } });
    const subscribeResult = await post.json().catch(() => null);
    const get = await fetch(base, { headers: { Authorization: `Bearer ${WA_TOKEN}` } });
    const currentSubscribedApps = await get.json().catch(() => null);
    return res.status(200).json({ ok: post.ok, waba, subscribeResult, currentSubscribedApps });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
