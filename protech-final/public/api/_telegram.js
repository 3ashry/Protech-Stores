// Telegram helper — one-way admin notifications for the Protech dashboard.
// Called by:
//   - bosta.js       → tgNotifyOrder(...)         on every new order
//   - sync-status.js → tgNotifyStatusChange(...)  on every status flip
//   - sync-status.js → tgSendDailySummary(...)    once a day from the cron
//
// Underscore-prefixed so Vercel doesn't route it as a function.
// Failures never throw; the caller flow must be uninterrupted.
const TG_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TG_CHAT  = (process.env.TELEGRAM_CHAT_ID || '').trim();
const DASHBOARD_URL = (process.env.DASHBOARD_URL || 'https://protech-stores.vercel.app').replace(/\/$/, '');

export function tgConfigured() { return !!(TG_TOKEN && TG_CHAT); }

// Escape user-supplied text for parse_mode=HTML. HTML is preferred over
// Markdown because customer names / addresses often contain characters
// that break Markdown parsers (underscores, asterisks, brackets).
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Format an EGP amount for the user-visible line (English digits, 2dp).
function money(n) {
  const x = Number(n || 0);
  return isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(n || '');
}

// Normalise a phone into E.164 for tel: and wa.me links.
// Egyptian country code is +20, so a local 010/011/012/015 number gets its
// leading 0 replaced by +20 (not +2 — +2 alone is Egypt's dial prefix and
// yields an invalid international number that Telegram rejects as
// "Wrong port number specified in the URL").
function normPhone(p) {
  let s = String(p || '').trim().replace(/[\s()-]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (s.startsWith('00')) return '+' + s.slice(2);   // 002010... → +2010...
  if (s.startsWith('0')) return '+20' + s.slice(1);  // 010... → +2010...
  if (s.startsWith('20')) return '+' + s;            // 2010... → +2010...
  return '+20' + s;                                  // 10... → +2010...
}

// Low-level Telegram sender. `opts` may carry an `inlineKeyboard` — a 2-D
// array of button rows: [[{text, url}], [{text, url}, {text, url}]].
export async function tgSend(text, opts = {}) {
  if (!TG_TOKEN || !TG_CHAT) return { ok: false, error: 'not configured' };
  const payload = {
    chat_id: TG_CHAT,
    text: String(text || ''),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (opts.inlineKeyboard) {
    payload.reply_markup = { inline_keyboard: opts.inlineKeyboard };
  }
  if (opts.disableNotification) payload.disable_notification = true;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body?.ok) console.warn('telegram sendMessage failed', r.status, JSON.stringify(body));
    return { ok: r.ok && body?.ok === true, status: r.status, body };
  } catch (e) {
    console.warn('telegram sendMessage exception', e && e.message);
    return { ok: false, error: e.message };
  }
}

// Buttons for a fresh order. Telegram inline-button URLs only accept
// http/https/tg:// — `tel:` is silently rejected as "Wrong port number
// specified in the URL". The phone lives in the message body as
// <code>…</code> which Telegram renders tap-to-copy; long-press → call.
function newOrderButtons({ phone, orderId, customerName }) {
  const p = normPhone(phone);
  const waPhone = p.replace(/^\+/, '');
  const waMsg = encodeURIComponent(
    `مرحباً ${customerName || ''} 👋\nمعاك بروتيك — تأكيد طلبك بتاعك.`
  );
  const rows = [];
  if (p) rows.push([{ text: '💬 واتساب', url: `https://wa.me/${waPhone}?text=${waMsg}` }]);
  if (orderId) rows.push([{ text: '📋 فتح لوحة التحكم', url: `${DASHBOARD_URL}/#/orders?focus=${encodeURIComponent(orderId)}` }]);
  return rows.length ? rows : null;
}

// Buttons for a status-change ping — includes a Bosta track button when
// the ship_code (tracking number) is known.
function statusButtons({ phone, shipCode, orderId }) {
  const p = normPhone(phone);
  const waPhone = p.replace(/^\+/, '');
  const rows = [];
  const row1 = [];
  if (p) row1.push({ text: '💬 واتساب', url: `https://wa.me/${waPhone}` });
  if (shipCode) row1.push({ text: '🔗 تتبع بوسطة', url: `https://bosta.co/en-eg/tracking-shipments/${encodeURIComponent(shipCode)}` });
  if (row1.length) rows.push(row1);
  if (orderId) rows.push([{ text: '📋 لوحة التحكم', url: `${DASHBOARD_URL}/#/orders?focus=${encodeURIComponent(orderId)}` }]);
  return rows.length ? rows : null;
}

// Convenience: new-order alert with call / whatsapp / dashboard buttons.
// `orderId` here is the DB id used by the dashboard `?focus=` deep-link.
export async function tgNotifyOrder({ orderId, customerName, phone, city, address, total, allowOpen, code } = {}) {
  if (!tgConfigured()) return { ok: false, error: 'not configured' };
  const displayCode = code || orderId || '';
  const text = [
    `🛒 <b>طلب جديد</b>`,
    ``,
    `👤 ${esc(customerName || 'عميل')}`,
    `📱 <code>${esc(phone || '')}</code>`,
    `📍 ${esc(city || '')}${address ? ' — ' + esc(address) : ''}`,
    `💰 <b>${esc(money(total))}</b> ج.م`,
    allowOpen ? `📦 يريد فتح الشحنة قبل الاستلام` : '',
    ``,
    `🆔 <code>${esc(displayCode)}</code>`,
  ].filter(Boolean).join('\n');
  return tgSend(text, { inlineKeyboard: newOrderButtons({ phone, orderId, customerName }) });
}

// Status-change alert. Called from sync-status.js whenever an order flips
// to a new status. `from`/`to` are the human-facing status strings we
// already use in the dashboard (Delivered, Returned, Heading to Customer, …).
const STATUS_EMOJI = {
  'Delivered': '✅',
  'Returned': '↩️',
  'Cancelled': '❌',
  'Heading to Customer': '🚚',
  'On its way to me': '🏠',
  'In Transit': '📦',
  'Processing': '⏳',
  'Awaiting Action': '⚠️',
};
export async function tgNotifyStatusChange(order, from, to) {
  if (!tgConfigured()) return { ok: false, error: 'not configured' };
  if (!order || !to || from === to) return { ok: false, error: 'noop' };
  const emoji = STATUS_EMOJI[to] || '🔄';
  const displayCode = order.code || order.id || '';
  const parts = [
    `${emoji} <b>${esc(to)}</b>`,
    ``,
    `🆔 <code>${esc(displayCode)}</code>`,
    order.customer_name ? `👤 ${esc(order.customer_name)}` : '',
    order.city ? `📍 ${esc(order.city)}` : '',
    order.total ? `💰 ${esc(money(order.total))} ج.م` : '',
    from ? `<i>من ${esc(from)} → ${esc(to)}</i>` : '',
  ].filter(Boolean).join('\n');
  return tgSend(parts, {
    inlineKeyboard: statusButtons({ phone: order.phone, shipCode: order.ship_code, orderId: order.id }),
    // Delivered / Returned / Cancelled are worth a full ping; intermediate
    // moves (In Transit, Heading to Customer) fire silently to avoid alarm
    // fatigue when a busy day flips many orders.
    disableNotification: !(to === 'Delivered' || to === 'Returned' || to === 'Cancelled'),
  });
}

// End-of-day roll-up. `stats` shape:
//   { newToday, delivered, returned, inTransit, revenue, cashCycleClosed }
export async function tgSendDailySummary(stats = {}) {
  if (!tgConfigured()) return { ok: false, error: 'not configured' };
  const {
    newToday = 0, delivered = 0, returned = 0, inTransit = 0,
    revenue = 0, cashCycleOpen = 0, dateLabel = '',
  } = stats;
  const text = [
    `📊 <b>ملخص اليوم${dateLabel ? ' — ' + esc(dateLabel) : ''}</b>`,
    ``,
    `🛒 طلبات جديدة اليوم: <b>${newToday}</b>`,
    `✅ تم توصيلها اليوم: <b>${delivered}</b>`,
    `↩️ تم ارجاعها اليوم: <b>${returned}</b>`,
    `🚚 قيد الشحن حالياً: <b>${inTransit}</b>`,
    `🕒 دورات مالية لسه مفتوحة: <b>${cashCycleOpen}</b>`,
    ``,
    `💰 إجمالي الإيرادات اليوم: <b>${esc(money(revenue))}</b> ج.م`,
  ].join('\n');
  return tgSend(text, {
    inlineKeyboard: [[{ text: '📋 فتح لوحة التحكم', url: `${DASHBOARD_URL}/` }]],
  });
}
