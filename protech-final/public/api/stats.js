// protech-final/public/api/stats.js
// Lightweight JSON stats for a phone / Apple Watch widget.
//   GET /api/stats?key=<CRON_SECRET>
// Returns: { orders, delivered, inTransit, processing, today }
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const CRON_SECRET = (process.env.CRON_SECRET || '').trim();

// Count rows matching an optional PostgREST filter, using the Content-Range header
// (count=exact) so we never download the rows themselves.
async function countOrders(filter = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?select=id${filter}`, {
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'count=exact', Range: '0-0',
    },
  });
  const cr = r.headers.get('content-range') || '';
  return parseInt(cr.split('/')[1] || '0', 10) || 0;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const key = ((req.query && (req.query.key || req.query.secret)) || '').toString().trim();
  if (CRON_SECRET && key !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'not configured' });

  try {
    const today = new Date().toISOString().slice(0, 10); // UTC date (YYYY-MM-DD)
    const [orders, delivered, inTransit, processing, todayCount] = await Promise.all([
      countOrders(),
      countOrders('&status=eq.Delivered'),
      countOrders('&status=eq.In%20Transit'),
      countOrders('&status=eq.Processing'),
      countOrders(`&date=eq.${today}`),
    ]);
    return res.status(200).json({ orders, delivered, inTransit, processing, today: todayCount });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
