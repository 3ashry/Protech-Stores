// protech-final/public/api/_agent-report.js
// Served through /api/stats?action=agent-report (POST): the Hobby plan allows
// 12 functions and all 12 are taken, so this rides on stats.js.
// Sends a new agent report (public.agent_reports) to the admin's Telegram.
//
// Called by the database webhook on every insert into agent_reports. The
// request body is NOT trusted: we only take the row id from it, then read the
// row ourselves with the service key and send it exactly once — the row is
// claimed (telegram_sent_at set) before sending, so retries and duplicate
// webhook calls can't double-send.
//
// Env (already set for the other functions): SUPABASE_URL, SUPABASE_KEY,
// TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, DASHBOARD_URL (optional).
import { tgSend, tgConfigured } from './_telegram.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const DASHBOARD_URL = (process.env.DASHBOARD_URL || 'https://protech-stores.vercel.app').replace(/\/$/, '');

const sbHeaders = () => ({
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const ICON = { info: '🧠', warn: '⚠️', alert: '🚨' };
const KIND = {
  daily_check: 'Daily check', weekly_brief: 'Weekly brief', pricing: 'Pricing report',
  market: 'Market research', alert: 'Alert', test: 'Test',
};

export async function agentReportHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });
  if (!tgConfigured()) return res.status(500).json({ error: 'Telegram not configured' });

  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const id = parseInt((body.record && body.record.id) || body.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'missing report id' });

  // Claim the row: only succeeds if it hasn't been sent yet.
  const claim = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_reports?id=eq.${id}&telegram_sent_at=is.null&notify=is.true`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify({ telegram_sent_at: new Date().toISOString() }),
    }
  );
  const rows = await claim.json().catch(() => []);
  if (!claim.ok) return res.status(502).json({ error: 'claim failed' });
  if (!Array.isArray(rows) || !rows.length) return res.status(200).json({ ok: true, skipped: 'already sent or not found' });
  const r = rows[0];

  const head = `${ICON[r.severity] || ICON.info} <b>${esc(KIND[r.kind] || r.kind)} — ${esc(r.title)}</b>`;
  let summary = esc(r.summary);
  if (summary.length > 3500) summary = summary.slice(0, 3500) + '…';
  const text = `${head}\n\n${summary}`;

  const sent = await tgSend(text, {
    inlineKeyboard: [[{ text: 'Open full report', url: `${DASHBOARD_URL}/team.html#r${r.id}` }]],
    disableNotification: r.severity === 'info' && r.kind === 'daily_check',
  });

  if (!sent.ok) {
    // Release the claim and record why, so it shows on the Team page.
    await fetch(`${SUPABASE_URL}/rest/v1/agent_reports?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...sbHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        telegram_sent_at: null,
        telegram_error: String((sent.body && sent.body.description) || sent.error || `HTTP ${sent.status}`).slice(0, 300),
      }),
    }).catch(() => {});
    return res.status(502).json({ ok: false, error: 'telegram send failed' });
  }
  return res.status(200).json({ ok: true, id });
}
