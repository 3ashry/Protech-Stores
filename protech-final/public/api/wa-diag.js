// protech-final/public/api/wa-diag.js
// Diagnostic endpoint — uses the CURRENT Vercel WA_TOKEN + WA_PHONE_NUMBER_ID
// to tell you which WhatsApp Business Account the server is actually talking
// to, and what version of each template is live there. Call it to confirm
// whether your Vercel token points at the same WABA where you approved the
// new 5-var templates.
//
// Access: GET /api/wa-diag?key=<CRON_SECRET>  (or send a Supabase JWT as Bearer)
// Safe to leave in place — it returns metadata only (no secret values, no
// customer data). Still auth-protected so random browsers can't poke it.

const WA_TOKEN = process.env.WA_TOKEN;
const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const CRON_SECRET = (process.env.CRON_SECRET || '').trim();

async function authorized(req) {
  const auth = (req.headers.authorization || '').trim();
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (CRON_SECRET) {
    if (bearer === CRON_SECRET) return true;
    const key = ((req.query && (req.query.key || req.query.secret)) || '').toString().trim();
    if (key === CRON_SECRET) return true;
  }
  if (bearer && bearer !== CRON_SECRET && SUPABASE_URL && SUPABASE_KEY) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${bearer}` },
      });
      if (r.ok) { const u = await r.json().catch(() => null); if (u && u.id) return true; }
    } catch (_) {}
  }
  return !CRON_SECRET;
}

export default async function handler(req, res) {
  if (!(await authorized(req))) return res.status(401).json({ error: 'Unauthorized' });
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) {
    return res.status(500).json({ error: 'WA_TOKEN or WA_PHONE_NUMBER_ID not set in Vercel' });
  }

  const out = { ok: true, phoneNumberId: WA_PHONE_NUMBER_ID };

  // 1) Who is this phone number? → display name, verified name, WABA id.
  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${WA_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier,account_mode,id`,
      { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
    );
    out.phone = await r.json().catch(() => ({ error: 'phone fetch parse failed' }));
    if (!r.ok) out.phone._httpStatus = r.status;
  } catch (e) { out.phone = { error: String(e && e.message || e) }; }

  // 2) Which WABA owns this phone? Try the /whatsapp_business_account edge.
  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${WA_PHONE_NUMBER_ID}?fields=whatsapp_business_account{id,name,currency,timezone_id,message_template_namespace}`,
      { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
    );
    const d = await r.json().catch(() => ({}));
    out.waba = d?.whatsapp_business_account || d;
    if (!r.ok) out.waba._httpStatus = r.status;
  } catch (e) { out.waba = { error: String(e && e.message || e) }; }

  const wabaId = out.waba && out.waba.id;

  // 3) List the templates on that WABA — focus on order_* so output stays small.
  if (wabaId) {
    try {
      const url = `https://graph.facebook.com/v21.0/${wabaId}/message_templates?fields=name,language,status,category,components&limit=100`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${WA_TOKEN}` } });
      const d = await r.json().catch(() => ({}));
      const all = Array.isArray(d.data) ? d.data : [];
      const relevant = all.filter(t => String(t.name || '').startsWith('order_'));
      out.templates = relevant.map(t => {
        const body = (t.components || []).find(c => c.type === 'BODY');
        const text = (body && body.text) || '';
        // Count placeholders by the highest {{N}} that appears in the body.
        const matches = text.match(/\{\{(\d+)\}\}/g) || [];
        const maxVar = matches.reduce((m, s) => {
          const n = parseInt(s.replace(/[^0-9]/g, ''), 10) || 0;
          return n > m ? n : m;
        }, 0);
        return {
          name: t.name,
          language: t.language,
          status: t.status,
          category: t.category,
          bodyParamCount: maxVar,
          bodyPreview: text.slice(0, 300),
          buttons: ((t.components || []).find(c => c.type === 'BUTTONS') || {}).buttons || [],
        };
      });
      out.allTemplateNames = all.map(t => t.name).sort();
    } catch (e) { out.templates = { error: String(e && e.message || e) }; }
  } else {
    out.templates = { skipped: 'no waba id resolved' };
  }

  return res.status(200).json(out);
}
