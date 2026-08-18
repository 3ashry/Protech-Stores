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
  // Play the cash-register sound at full volume for each new order.
  // A "primed" element (created on the first user gesture, see bottom of
  // this file) is reused so mobile autoplay policy doesn't silence it.
  try {
    const a = window._orderChime ? window._orderChime.cloneNode() : new Audio('/cash.mp3');
    a.volume = 1.0;
    a.play().catch(() => {
      // If cloning path was blocked, retry with a fresh Audio (this fires
      // after the first genuine user gesture on the page).
      try { new Audio('/cash.mp3').play().catch(() => {}); } catch (_) {}
    });
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
    if (typeof showToast === 'function') showToast('🔔 الإشعارات مفعّلة — جاري ربط الجهاز…');
    subscribeToPush().finally(() => {
      if (typeof showToast === 'function') showToast('🔔 الجهاز جاهز — ستصلك إشعارات حتى لو التطبيق مقفول');
    });
    return;
  }
  if (Notification.permission === 'denied') {
    if (typeof showToast === 'function') showToast('الإشعارات مرفوضة من إعدادات المتصفح — فعّلها من هناك');
    return;
  }
  Notification.requestPermission().then(async perm => {
    if (perm === 'granted') {
      hideOrderNotifPrompt();
      if (typeof showToast === 'function') showToast('🔔 تم تفعيل الإشعارات — جاري ربط الجهاز…');
      try {
        new Notification('بروتيك — إشعارات مفعّلة ✓', {
          body: 'ستصلك رسالة هنا عند كل طلب جديد.',
          icon: '/favicon.png',
        });
      } catch (_) {}
      await subscribeToPush();
      if (typeof showToast === 'function') showToast('🔔 الجهاز جاهز — ستصلك إشعارات حتى لو التطبيق مقفول');
    } else if (perm === 'denied') {
      if (typeof showToast === 'function') showToast('لم يتم تفعيل الإشعارات');
    }
  });
}

// ── Web Push subscription ─────────────────────────────────────────────
// Registers this device with the server so pushes can arrive even when
// the PWA is closed / phone is locked. Requires:
//   1) Notification permission (handled above)
//   2) The service worker registered (see index.html)
//   3) VAPID_PUBLIC_KEY env var set on Vercel + /api/push?action=pubkey
//      returning it.
function urlBase64ToUint8Array(b64) {
  const padding = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
async function subscribeToPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const reg = await navigator.serviceWorker.ready;
    // Already subscribed? Send it up again anyway — server upserts by endpoint.
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const r = await fetch('/api/push?action=pubkey');
      if (!r.ok) throw new Error('pubkey fetch failed');
      const { publicKey } = await r.json();
      if (!publicKey) throw new Error('empty public key');
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    const post = await fetch('/api/push?action=subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub }),
    });
    if (!post.ok) throw new Error('subscribe post failed: ' + post.status);
    return true;
  } catch (e) {
    console.warn('subscribeToPush failed:', e && e.message);
    return false;
  }
}
// Expose so an admin button (or console call) can re-subscribe manually.
window.subscribeToPush = subscribeToPush;

// If permission is already granted on page load (e.g. after installing the
// PWA and re-opening it), auto-subscribe silently. Small delay so the SW
// registration in index.html has time to complete.
window.addEventListener('load', () => {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  setTimeout(() => { subscribeToPush(); }, 3000);
});

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

// Prime the cash-register audio on the first user gesture so mobile browsers
// (which block autoplay until they see interaction) allow subsequent
// programmatic plays. Play muted the first time, then unmute for real
// notifications — the muted play satisfies the autoplay policy.
(function primeOrderChime() {
  const unlock = () => {
    try {
      const a = new Audio('/cash.mp3');
      a.muted = true;
      a.play().then(() => {
        a.pause();
        a.currentTime = 0;
        a.muted = false;
        window._orderChime = a;
      }).catch(() => {});
    } catch (_) {}
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true });
  window.addEventListener('touchstart', unlock, { once: true, passive: true });
})();

// If the service worker (Web Push) delivers a notification while the app is
// open in the background, it can post a message to any open clients — we
// use that to fire the cash chime alongside the system banner.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'play-cash-sound') {
      try {
        const a = window._orderChime ? window._orderChime.cloneNode() : new Audio('/cash.mp3');
        a.volume = 1.0;
        a.play().catch(() => {});
      } catch (_) {}
    }
  });
}
