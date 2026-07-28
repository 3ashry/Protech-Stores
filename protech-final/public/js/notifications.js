// ═══════════════════════════════════════════════════════════════════
//  BROWSER PUSH NOTIFICATIONS — fires when a new order arrives
//
//  Uses the native Notification API. Piggybacks on the existing 30-second
//  auto-refresh in db.js: every refresh compares the newly-fetched orders
//  against the last-seen set and notifies for anything new.
//
//  Browsers require an explicit user gesture to grant permission, so a
//  floating banner appears (bottom-right) whenever permission is still
//  "default" — clicking Enable triggers the browser prompt.
// ═══════════════════════════════════════════════════════════════════

let _lastSeenOrderIds = null;   // null → not yet initialised (first run seeds)

// Called externally by db.js's refresh cycle. `orders` is the freshly fetched
// list. On the first call we just seed the seen set — otherwise fire a
// notification for every order that wasn't in the previous set.
function notifyForNewOrders(orders) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  const list = Array.isArray(orders) ? orders : [];
  if (_lastSeenOrderIds === null) {
    _lastSeenOrderIds = new Set(list.map(o => o.id));
    return;
  }
  const seen = _lastSeenOrderIds;
  const fresh = list.filter(o => o && o.id && !seen.has(o.id));
  // Refresh the seen set BEFORE firing so a subsequent quick-refresh can't
  // double-notify the same order.
  _lastSeenOrderIds = new Set(list.map(o => o.id));
  if (!fresh.length) return;
  // Cap notifications so a large one-off backfill doesn't spam.
  for (const o of fresh.slice(0, 5)) {
    try {
      const total = parseFloat(o.total || 0);
      const totalTxt = isFinite(total) ? total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (o.total || '');
      const body = [
        o.customer_name || 'عميل',
        o.city || '',
        totalTxt ? `${totalTxt} ج.م` : ''
      ].filter(Boolean).join(' — ');
      const n = new Notification(`🛒 طلب جديد — ${o.code || o.id}`, {
        body,
        icon: '/favicon.png',
        badge: '/favicon.png',
        tag: `order-${o.id}`,
        requireInteraction: true,   // keeps the banner up until the admin acts
      });
      n.onclick = () => {
        try { window.focus(); } catch (_) {}
        try { if (typeof go === 'function') go('orders'); } catch (_) {}
        n.close();
      };
    } catch (e) { console.warn('notify failed:', e); }
  }
  // Soft chime — the login handler already primes an Audio() so this is
  // allowed by autoplay policy after a user gesture.
  try {
    const a = new Audio('/cash.mp3');
    a.volume = 0.6;
    a.play().catch(() => {});
  } catch (_) {}
}

// UI: floating "Enable notifications" prompt while permission is still default.
function requestOrderNotifPermission() {
  if (!('Notification' in window)) {
    if (typeof showToast === 'function') showToast('هذا المتصفح لا يدعم الإشعارات');
    return;
  }
  if (Notification.permission === 'granted') {
    hideOrderNotifPrompt();
    if (typeof showToast === 'function') showToast('🔔 الإشعارات مفعّلة بالفعل');
    return;
  }
  if (Notification.permission === 'denied') {
    if (typeof showToast === 'function') showToast('الإشعارات مرفوضة من إعدادات المتصفح — فعّلها من هناك');
    return;
  }
  Notification.requestPermission().then(perm => {
    if (perm === 'granted') {
      hideOrderNotifPrompt();
      if (typeof showToast === 'function') showToast('🔔 تم تفعيل الإشعارات — ستصلك عند كل طلب جديد');
      try {
        new Notification('بروتيك — إشعارات مفعّلة ✓', {
          body: 'ستصلك رسالة هنا عند كل طلب جديد.',
          icon: '/favicon.png',
        });
      } catch (_) {}
    } else if (perm === 'denied') {
      if (typeof showToast === 'function') showToast('لم يتم تفعيل الإشعارات');
    }
  });
}

function hideOrderNotifPrompt() {
  const el = document.getElementById('notif-prompt');
  if (el) el.remove();
}

function showOrderNotifPrompt() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return; // granted → skip; denied → nothing to prompt for
  if (document.getElementById('notif-prompt')) return;
  const el = document.createElement('div');
  el.id = 'notif-prompt';
  el.innerHTML = `
    <div style="position:fixed;bottom:20px;left:20px;background:#1f2937;color:#fff;padding:14px 18px;border-radius:12px;
                box-shadow:0 12px 40px rgba(0,0,0,.4);z-index:998;display:flex;align-items:center;gap:14px;
                max-width:360px;font-family:Cairo,sans-serif;direction:rtl">
      <div style="font-size:28px">🔔</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:14px;margin-bottom:2px">تفعيل إشعارات الطلبات</div>
        <div style="font-size:12px;color:rgba(255,255,255,.7);line-height:1.4">استلم إشعار فوري في المتصفح مع كل طلب جديد.</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <button onclick="requestOrderNotifPermission()" style="background:#F26A21;color:#fff;border:0;border-radius:8px;padding:7px 14px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">تفعيل</button>
        <button onclick="hideOrderNotifPrompt()" style="background:transparent;color:rgba(255,255,255,.6);border:0;padding:4px;font-size:11px;cursor:pointer;font-family:inherit">لاحقاً</button>
      </div>
    </div>`;
  document.body.appendChild(el);
}

// Auto-show the prompt shortly after login (gives the dashboard a moment to render).
// Guard with a session flag so re-navigating in the same session doesn't reappear.
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    if (sessionStorage.getItem('protech_notif_prompt_shown')) return;
    // Only show the prompt when the dashboard is actually visible (post-login).
    const app = document.getElementById('app');
    if (!app || app.style.display === 'none') return;
    sessionStorage.setItem('protech_notif_prompt_shown', '1');
    showOrderNotifPrompt();
  }, 2500);
});
