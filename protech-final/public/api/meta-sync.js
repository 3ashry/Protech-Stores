// protech-final/public/api/meta-sync.js
// Pulls daily ad spend per campaign from the Meta (Facebook) Marketing API
// and upserts it into public.meta_ad_spend_daily. Re-fetches the last few
// days each run so late corrections/attribution settle (spend for a day can
// still change for ~72h). The media-buyer 20% and the financials read this
// table — the admin never types ad spend by hand once this is wired.
//
// Schedule it (Vercel Cron or cron-job.org) nightly; it's also safe to hit
// manually from the admin to refresh now.
//
// Required Vercel env vars (server-side only — never in browser code):
//   META_ACCESS_TOKEN     long-lived / System User token with ads_read
//   META_AD_ACCOUNT_ID    the ad account id, digits only (no "act_" prefix)
//   SUPABASE_URL          https://wljxplbcfoorqpoflcdz.supabase.co
//   SUPABASE_KEY          Supabase service_role key (bypasses RLS)
//   CRON_SECRET           (optional) shared secret to authorize the call
//   META_API_VERSION      (optional) defaults to v21.0
//   META_SYNC_DAYS        (optional) how many trailing days to refetch (default 3)

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_AD_ACCOUNT_ID = String(process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const CRON_SECRET = (process.env.CRON_SECRET || '').trim();
const API_VERSION = process.env.META_API_VERSION || 'v21.0';
const SYNC_DAYS = Math.min(90, Math.max(1, parseInt(process.env.META_SYNC_DAYS || '3', 10) || 3));

// A request may trigger the sync two ways:
//   1. The nightly cron / a manual curl — carries the CRON_SECRET (as a
//      Bearer token or ?key=/?secret= query param).
//   2. The in-app "Sync Meta" button — carries the signed-in admin's
//      Supabase JWT, which we verify against Supabase's /auth/v1/user.
async function authorized(req) {
  const auth = (req.headers.authorization || '').trim();
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  // 1. Shared-secret path (cron / server-to-server).
  if (CRON_SECRET) {
    if (bearer === CRON_SECRET) return true;
    const key = ((req.query && (req.query.key || req.query.secret)) || '').toString().trim();
    if (key === CRON_SECRET) return true;
  }
  // 2. Admin path: a valid Supabase user JWT (anyone signed into the admin).
  if (bearer && bearer !== CRON_SECRET && SUPABASE_URL && SUPABASE_KEY) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${bearer}` },
      });
      if (r.ok) { const u = await r.json().catch(() => null); if (u && u.id) return true; }
    } catch (_) {}
  }
  // 3. No secret configured at all -> allow (dev only).
  if (!CRON_SECRET) return true;
  return false;
}

// YYYY-MM-DD in Africa/Cairo for a given Date (so "today" matches the
// business day the rest of the system uses).
function cairoDate(d) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${day}`;
}

export default async function handler(req, res) {
  if (!(await authorized(req))) return res.status(401).json({ error: 'Unauthorized' });
  if (!META_ACCESS_TOKEN || !META_AD_ACCOUNT_ID) {
    return res.status(500).json({ error: 'Meta not configured — set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID.' });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured.' });
  }

  // Window: last SYNC_DAYS days through today (Cairo). ?since & ?until override.
  const today = new Date();
  const start = new Date(today.getTime() - (SYNC_DAYS - 1) * 86400000);
  const since = (req.query && req.query.since) || cairoDate(start);
  const until = (req.query && req.query.until) || cairoDate(today);

  try {
    // Per-campaign, per-day spend. time_increment=1 => one row per campaign/day.
    const base = `https://graph.facebook.com/${API_VERSION}/act_${encodeURIComponent(META_AD_ACCOUNT_ID)}/insights`;
    const params = new URLSearchParams({
      level: 'campaign',
      time_increment: '1',
      fields: 'campaign_id,campaign_name,spend,account_currency',
      time_range: JSON.stringify({ since, until }),
      limit: '500',
      access_token: META_ACCESS_TOKEN,
    });
    let url = `${base}?${params.toString()}`;

    const rows = [];
    let currency = null;
    let guard = 0;
    while (url && guard++ < 50) {
      const r = await fetch(url);
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        return res.status(502).json({ error: 'Meta API error', details: d && d.error ? d.error : d });
      }
      for (const row of (d.data || [])) {
        currency = currency || row.account_currency || null;
        rows.push({
          spend_date: row.date_start,                 // YYYY-MM-DD
          campaign_id: row.campaign_id || null,
          campaign_name: row.campaign_name || null,
          spend: Math.round((parseFloat(row.spend) || 0) * 100) / 100,
          currency: row.account_currency || null,
          updated_at: new Date().toISOString(),
        });
      }
      url = d.paging && d.paging.next ? d.paging.next : null;
    }

    // Upsert by (spend_date, campaign_id). Days with no spend simply have no
    // row for that campaign — that's fine; the readers sum what exists.
    let upserted = 0;
    if (rows.length) {
      const up = await fetch(
        `${SUPABASE_URL}/rest/v1/meta_ad_spend_daily?on_conflict=spend_date,campaign_id`,
        {
          method: 'POST',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(rows),
        }
      );
      if (!up.ok) {
        return res.status(502).json({ error: 'Supabase upsert failed', details: await up.text().catch(() => '') });
      }
      upserted = rows.length;
    }

    const result = { ok: true, since, until, currency, rows: upserted };
    console.log('meta-sync', JSON.stringify(result));
    return res.status(200).json(result);
  } catch (e) {
    console.error('meta-sync error', e.message);
    return res.status(500).json({ error: e.message });
  }
}
