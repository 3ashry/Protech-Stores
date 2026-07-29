// Tiny Telegram helper. Used by /api/bosta to ping the admin with every
// new order. Failure is always best-effort — the order flow must never
// break if Telegram is unreachable / unconfigured.
const TG_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TG_CHAT  = (process.env.TELEGRAM_CHAT_ID || '').trim();

export function tgConfigured() { return !!(TG_TOKEN && TG_CHAT); }

// Sends a Markdown-formatted message to the configured chat. Never throws.
export async function tgSend(text) {
  if (!TG_TOKEN || !TG_CHAT) return { ok: false, error: 'not configured' };
  try {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text: String(text || ''),
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
    const body = await r.json().catch(() => null);
    return { ok: r.ok && body?.ok === true, status: r.status, body };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Convenience: build and send the "new order" notification. Fields are the
// same shape the storefront POSTs to /api/bosta so the caller passes req.body.
export async function tgNotifyOrder({ orderId, customerName, phone, city, address, total, allowOpen }) {
  if (!tgConfigured()) return { ok: false, error: 'not configured' };
  const money = (n) => {
    const x = Number(n || 0);
    return isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(n || '');
  };
  const text = [
    `🛒 *طلب جديد*`,
    ``,
    `👤 ${customerName || 'عميل'}`,
    `📱 \`${phone || ''}\``,
    `📍 ${city || ''}${address ? ' — ' + address : ''}`,
    `💰 *${money(total)}* ج.م`,
    allowOpen ? `📦 يريد فتح الشحنة قبل الاستلام` : '',
    ``,
    `🆔 \`${orderId || ''}\``,
  ].filter(Boolean).join('\n');
  return tgSend(text);
}
