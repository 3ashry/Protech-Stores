function playNotificationSound() {
  try {
    const audio = new Audio('/cash.mp3');
    audio.volume = 1.0;
    audio.play().catch(() => {
      // fallback beep if audio fails
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
      gainNode.gain.setValueAtTime(0.5, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.5);
    });
  } catch(e) {}
}
// Add this function anywhere in app.js:
function printInvoice(id) {
  const o = cache.orders.find(x => x.id === id);
  if (!o) return;
  generateInvoicePDF(o);
}
// ── UTILS ──
const fmt = n => parseFloat(n || 0).toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const genCode = p => p + '-' + Date.now().toString(36).toUpperCase().slice(-6);
const today = () => new Date().toLocaleDateString('en-GB');
const phoneOk = p => /^01[0-9]{9}$/.test(p);

function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}
function updateSendShipBtn(orderId) {
  const shipCode = document.getElementById('o-shipcode')?.value?.trim();
  const existing = document.getElementById('send-ship-btn');
  if (existing) existing.remove();
  if (!shipCode) return;

  const o = cache.orders.find(x => x.id === orderId);
  if (!o) return;

  const products = Array.isArray(o.products)
    ? o.products.map(p => `• ${p.name || p.code} × ${p.qty || 1} — ${((p.sell_price || p.price || 0) * (p.qty || 1)).toLocaleString('ar-EG')} ج.م`).join('\n')
    : '';

  const shipping = o.est_shipping || 80;
  const total = o.total || 0;

  const msg = encodeURIComponent(
`مرحباً ${o.customer_name}

شكراً لطلبك من *بروتيك*
تم تجهيز طلبك وجاري الشحن.

*تفاصيل الطلب:*
${products}

رسوم الشحن: ${shipping} ج.م
*الإجمالي الكلي: ${total} ج.م*

فتح الشحنة قبل الاستلام: ${o.allow_open ? 'متاح' : 'غير متاح'}

*كود الشحن: ${shipCode}*
تتبع شحنتك: https://bosta.co/en-eg/tracking-shipments

بروتيك — الشغل عليك والعدة علينا
protechstores.com

برجاء تأكيد الطلب بإرسال كلمة *تأكيد* في رسالة`
  );

  const waPhone = (o.phone || '').startsWith('0') ? '2' + o.phone : o.phone;
  const waLink = `https://wa.me/${waPhone}?text=${msg}`;

  const btn = document.createElement('div');
  btn.id = 'send-ship-btn';
  btn.style.cssText = 'margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;';
  btn.innerHTML = `
    <a href="${waLink}" target="_blank" onclick="markConfirmSent('${orderId}')"
      style="display:inline-flex;align-items:center;gap:8px;background:#25D366;color:white;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">
      📲 إرسال كود الشحن عبر واتساب
    </a>
    <button onclick="generateInvoicePDF(${JSON.stringify({...o, ship_code: document.getElementById('o-shipcode').value.trim()}).replace(/'/g, "\\'")})"
      style="display:inline-flex;align-items:center;gap:8px;background:#f97316;color:white;padding:11px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:700;font-size:14px;">
      🧾 طباعة الفاتورة PDF
    </button>`;

  const shipGroup = document.getElementById('o-shipcode')?.closest('.form-group');
  if (shipGroup) shipGroup.after(btn);
}

// ── NAVIGATION ──
const SCREENS = ['home', 'inventory', 'orders', 'returns', 'financials', 'invoices', 'carts', 'analytics'];
function go(id) {
  if (id === 'analytics' && !analyticsCache.loaded) loadAnalytics();
  if (id === 'carts') loadAbandonedCarts();
  SCREENS.forEach(s => {
    document.getElementById('screen-' + s)?.classList.toggle('active', s === id);
  });
  document.querySelectorAll('#top-nav .nav-tab').forEach((t, i) => t.classList.toggle('active', SCREENS[i] === id));
  document.querySelectorAll('.bnav-btn').forEach((t, i) => t.classList.toggle('active', SCREENS[i] === id));
  renderAll();
}
// ═══════════════════════════════════════════════════════════════════
//  PROTECH ADMIN — Order Actions (WhatsApp Message + PDF Invoice)
//  Paste these functions into app.js BEFORE your renderOrders() call
// ═══════════════════════════════════════════════════════════════════

// ── 1. Build the WhatsApp message text ──────────────────────────────
function buildWhatsAppMessage(order) {
  const products = Array.isArray(order.products)
    ? order.products
        .map(p => `• ${p.name} × ${p.qty || 1} — ${((p.price || 0) * (p.qty || 1)).toLocaleString('ar-EG')} ج.م`)
        .join('\n')
    : 'لا توجد منتجات';

  const shipping = order.est_shipping ?? 80;
  const total = order.total ?? 0;

  const message =
`مرحباً ${order.customer_name} 👋

شكراً لطلبك من *بروتيك* 🛠️
تم تأكيد طلبك وجاري التجهيز.

📦 *تفاصيل الطلب:*
${products}

🚚 رسوم الشحن: ${shipping.toLocaleString('ar-EG')} ج.م
💰 *الإجمالي الكلي: ${total.toLocaleString('ar-EG')} ج.م*

📬 *كود الشحن: ${order.ship_code || 'سيتم إرساله قريباً'}*

سيتم التواصل معك فور شحن طلبك.
بروتيك — الشغل عليك والعدة علينا 🧡
protechstores.com`;

  return encodeURIComponent(message);
}

// ── 2. Generate and print PDF Invoice ───────────────────────────────
function generateInvoicePDF(order) {
  const products = Array.isArray(order.products)
    ? order.products
        .map(p => `
          <tr>
            <td>${esc(p.name) || '—'}</td>
            <td style="text-align:center">${p.qty || 1}</td>
            <td style="text-align:center">${(p.price || 0).toLocaleString('ar-EG')} ج.م</td>
            <td style="text-align:center">${((p.price || 0) * (p.qty || 1)).toLocaleString('ar-EG')} ج.م</td>
          </tr>`)
        .join('')
    : '<tr><td colspan="4" style="text-align:center">لا توجد منتجات</td></tr>';

  const orderDate = order.created_at || order.date
    ? new Date(order.created_at || order.date).toLocaleDateString('ar-EG', {
        year: 'numeric', month: 'long', day: 'numeric'
      })
    : '—';

  const invoiceHTML = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8"/>
  <title>فاتورة — ${esc(order.code || order.id)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      padding: 40px;
      color: #222;
      direction: rtl;
      background: #fff;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 20px;
      border-bottom: 4px solid #f97316;
      margin-bottom: 28px;
    }
    .brand-name {
      font-size: 32px;
      font-weight: 900;
      color: #f97316;
      letter-spacing: -1px;
    }
    .brand-tagline { font-size: 12px; color: #888; margin-top: 4px; }
    .invoice-meta { text-align: left; font-size: 13px; line-height: 1.8; }
    .invoice-meta .label { color: #888; font-size: 11px; }
    .invoice-meta .value { font-weight: bold; color: #222; }
    .section-title {
      font-size: 15px;
      font-weight: 700;
      color: #f97316;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid #fee2c8;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px 24px;
      background: #fff8f3;
      border: 1px solid #fed7aa;
      border-radius: 10px;
      padding: 16px 20px;
      margin-bottom: 28px;
      font-size: 14px;
    }
    .info-item { line-height: 1.6; }
    .info-label { color: #888; font-size: 11px; }
    .info-value { font-weight: 600; }
    .ship-code { color: #f97316; font-size: 16px; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      margin-bottom: 24px;
    }
    thead th {
      background: #f97316;
      color: white;
      padding: 10px 12px;
      text-align: center;
      font-weight: 600;
    }
    thead th:first-child { text-align: right; }
    tbody td {
      padding: 9px 12px;
      border-bottom: 1px solid #f0f0f0;
    }
    tbody tr:nth-child(even) { background: #fafafa; }
    .totals-section {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 40px;
    }
    .totals-table { min-width: 280px; font-size: 14px; }
    .totals-table td { padding: 7px 12px; }
    .totals-table .grand-total td {
      background: #f97316;
      color: white;
      font-size: 16px;
      font-weight: 700;
      border-radius: 0;
    }
    .footer {
      text-align: center;
      color: #aaa;
      font-size: 11px;
      border-top: 1px solid #eee;
      padding-top: 16px;
    }
    @media print {
      body { padding: 20px; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>

  <!-- Print Button (hidden on print) -->
  <div class="no-print" style="margin-bottom:20px;text-align:left">
    <button onclick="window.print()"
      style="background:#f97316;color:white;padding:10px 24px;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:bold">
      🖨️ طباعة / حفظ PDF
    </button>
  </div>

  <!-- Header -->
  <div class="header">
    <div>
      <div class="brand-name">🛠️ بروتيك</div>
      <div class="brand-tagline">الشغل عليك والعدة علينا</div>
    </div>
    <div class="invoice-meta">
      <div class="label">رقم الفاتورة</div>
      <div class="value">#${esc(order.code || order.id)}</div>
      <div class="label" style="margin-top:6px">تاريخ الطلب</div>
      <div class="value">${orderDate}</div>
    </div>
  </div>

  <!-- Customer Info -->
  <div class="section-title">بيانات العميل والشحن</div>
  <div class="info-grid">
    <div class="info-item">
      <div class="info-label">اسم العميل</div>
      <div class="info-value">${esc(order.customer_name) || '—'}</div>
    </div>
    <div class="info-item">
      <div class="info-label">رقم الهاتف</div>
      <div class="info-value">${esc(order.phone) || '—'}</div>
    </div>
    <div class="info-item">
      <div class="info-label">كود الشحن</div>
      <div class="info-value ship-code">${esc(order.ship_code) || 'لم يُحدَّد بعد'}</div>
    </div>
    <div class="info-item">
      <div class="info-label">حالة الطلب</div>
      <div class="info-value">${esc(order.status) || 'جديد'}</div>
    </div>
    ${order.notes ? `
    <div class="info-item" style="grid-column:1/-1">
      <div class="info-label">ملاحظات</div>
      <div class="info-value">${esc(order.notes)}</div>
    </div>` : ''}
  </div>

  <!-- Products Table -->
  <div class="section-title">المنتجات المطلوبة</div>
  <table>
    <thead>
      <tr>
        <th style="text-align:right">المنتج</th>
        <th>الكمية</th>
        <th>سعر الوحدة</th>
        <th>الإجمالي</th>
      </tr>
    </thead>
    <tbody>
      ${products}
    </tbody>
  </table>

  <!-- Totals -->
  <div class="totals-section">
    <table class="totals-table">
      <tr>
        <td style="color:#888">رسوم الشحن</td>
        <td style="text-align:left;font-weight:600">${(order.est_shipping ?? 80).toLocaleString('ar-EG')} ج.م</td>
      </tr>
      <tr class="grand-total">
        <td>💰 الإجمالي الكلي</td>
        <td style="text-align:left">${(order.total ?? 0).toLocaleString('ar-EG')} ج.م</td>
      </tr>
    </table>
  </div>

  <!-- Footer -->
  <div class="footer">
    بروتيك | protechstores.com | واتساب: 201091011380+<br/>
    شكراً لثقتك بنا 🧡
  </div>

</body>
</html>`;

  const win = window.open('', '_blank', 'width=850,height=900');
  if (win) {
    win.document.write(invoiceHTML);
    win.document.close();
  } else {
    alert('يرجى السماح بالنوافذ المنبثقة لطباعة الفاتورة');
  }
}

// ═══════════════════════════════════════════════════════════════════
//  HOW TO USE IN YOUR renderOrders() FUNCTION
//  Find where you build the HTML string for each order card and
//  add the following HTML block inside each order card:
// ═══════════════════════════════════════════════════════════════════
//
//  Step 1: Store the order object on the button using data attribute
//  Step 2: Add the buttons HTML to the order card
//
//  EXAMPLE — inside your renderOrders map/forEach:
//
//    const orderDataAttr = JSON.stringify(order).replace(/'/g, "\\'");
//
//    const actionsHTML = `
//      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;border-top:1px solid #f0f0f0;padding-top:12px">
//        <a
//          href="https://wa.me/2${(order.phone||'').replace(/^0/,'')}?text=${buildWhatsAppMessage(order)}"
//          target="_blank"
//          style="display:inline-flex;align-items:center;gap:6px;background:#25D366;color:white;
//                 padding:9px 18px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:13px"
//        >
//          📲 إرسال واتساب
//        </a>
//        <button
//          onclick='generateInvoicePDF(${JSON.stringify(order).replace(/\\/g,"\\\\").replace(/'/g,"\\'")})'
//          style="display:inline-flex;align-items:center;gap:6px;background:#f97316;color:white;
//                 padding:9px 18px;border-radius:8px;border:none;cursor:pointer;font-weight:bold;font-size:13px"
//        >
//          🧾 فاتورة PDF
//        </button>
//      </div>
//    `;
//
//  Then append actionsHTML to your order card HTML string.
// ═══════════════════════════════════════════════════════════════════


// ── RENDER ALL ──
function renderAll() {
  renderHome();
  renderInventory();
  renderOrders();
  renderReturns();
  renderFinancials();
  renderInvoices();
  renderAnalytics();
}

// ── HOME ──
function renderHome() {
  const orders = cache.orders;
  const total = orders.length;
  const delivered = orders.filter(o => o.status === 'Delivered').length;
  const inTransit = orders.filter(o => ['In Transit', 'Processing'].includes(o.status)).length;
  const fbs = cache.feedbacks;
  const isSatisfied = f => f.general === 'Satisfied' || f.general === 'راضي';
  const satPct = fbs.length ? Math.round(fbs.filter(isSatisfied).length / fbs.length * 100) : 0;

  document.getElementById('home-stats').innerHTML = `
    <div class="stat-card orange"><div class="stat-val">${total}</div><div class="stat-label">Total Orders</div></div>
    <div class="stat-card green"><div class="stat-val">${delivered}</div><div class="stat-label">Delivered</div></div>
    <div class="stat-card blue"><div class="stat-val">${inTransit}</div><div class="stat-label">In Transit</div></div>
    <div class="stat-card ${satPct >= 70 ? 'green' : 'red'}"><div class="stat-val">${satPct}%</div><div class="stat-label">Satisfaction</div></div>`;

  const hf = document.getElementById('home-feedback');
  if (!fbs.length) { hf.innerHTML = '<div class="empty"><div class="empty-icon">💬</div>No customer feedback yet</div>'; return; }
  hf.innerHTML = fbs.map(f => `
    <div class="fb-card">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px">
        <strong style="font-size:13px">${esc(f.order_code || f.orderCode) || '—'}</strong>
        <span class="badge ${(f.general === 'Satisfied' || f.general === 'راضي') ? 'b-success' : 'b-danger'}">${esc(f.general)}</span>
      </div>
      <div class="fb-pills">
        <span class="badge b-gray">Service: ${esc(f.service)}</span>
        <span class="badge b-gray">Quality: ${esc(f.quality)}</span>
        <span class="badge b-gray">Delivery: ${esc(f.delivery)}</span>
        <span class="badge b-gray">Packing: ${esc(f.packing)}</span>
        <span class="badge ${(f.recommend === 'Yes' || f.recommend === 'أنصح') ? 'b-success' : 'b-danger'}">Recommend: ${esc(f.recommend)}</span>
      </div>
      ${f.comment ? `<div style="font-size:13px;color:var(--muted);font-style:italic;margin-top:6px">"${esc(f.comment)}"</div>` : ''}
    </div>`).join('');
}

// ── CATEGORY LABELS ──
const CAT_LABELS = {
  electric: 'Electric Tools', battery: 'Battery Tools', hand: 'Hand Tools',
  measuring: 'Measuring Tools', safety: 'Safety Tools', car: 'Car Tools',
  garden: 'Gardening Tools', new: 'New Arrivals',
  sets: 'Tool Sets & Combos', accessories: 'Accessories',
};


// ── IMAGE UPLOAD ──
const SB_URL_IMG = 'https://wljxplbcfoorqpoflcdz.supabase.co';
const SB_KEY_IMG = 'sb_publishable_zsHh-eOarHI7BSGtuP6WWQ_PQ4ACoHG';

async function uploadProductImage(file, productId) {
  const ext = file.name.split('.').pop();
  const path = `products/${productId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const res = await fetch(`${SB_URL_IMG}/storage/v1/object/protech-media/${path}`, {
    method: 'POST',
    headers: { apikey: SB_KEY_IMG, Authorization: 'Bearer ' + (accessToken || SB_KEY_IMG), 'Content-Type': file.type, 'x-upsert': 'true' },
    body: file
  });
  if (!res.ok) throw new Error(await res.text());
  return `${SB_URL_IMG}/storage/v1/object/public/protech-media/${path}`;
}

function renderImagePreviews(images) {
  const container = document.getElementById('p-image-previews');
  if (!container) return;
  container.innerHTML = images.map((url, i) => `
    <div style="position:relative;width:80px;height:80px;border-radius:8px;overflow:hidden;border:2px solid ${i===0?'#F26A21':'#e0e0e0'}">
      <img src="${url}" style="width:100%;height:100%;object-fit:cover">
      ${i===0?'<div style="position:absolute;bottom:0;left:0;right:0;background:#F26A21;color:#fff;font-size:10px;font-weight:700;text-align:center;padding:2px">Main</div>':`<button onclick="setMainProductImage(${i})" style="position:absolute;bottom:2px;left:2px;background:rgba(0,0,0,.6);color:#fff;border:0;border-radius:5px;font-size:9px;font-weight:700;padding:2px 5px;cursor:pointer">Set Main</button>`}
      <button onclick="removeProductImage(${i})" style="position:absolute;top:2px;right:2px;width:20px;height:20px;background:rgba(200,0,0,.8);color:#fff;border:0;border-radius:50%;font-size:11px;cursor:pointer;display:grid;place-items:center">✕</button>
    </div>`).join('');
}

function setMainProductImage(idx) {
  if (idx <= 0 || idx >= currentProductImages.length) return;
  const [chosen] = currentProductImages.splice(idx, 1);
  currentProductImages.unshift(chosen);
  renderImagePreviews(currentProductImages);
}

let currentProductImages = [];


async function handleProductImageUpload(files) {
  if (!files || !files.length) return;
  showToast('Uploading images...');
  const id = document.getElementById('p-idx').value || ('new-' + Date.now());
  try {
    const urls = await Promise.all(Array.from(files).map(f => uploadProductImage(f, id)));
    currentProductImages = [...currentProductImages, ...urls];
    renderImagePreviews(currentProductImages);
    showToast('Images uploaded ✓');
  } catch(e) { showToast('Upload failed: ' + e.message); }
}

function removeProductImage(idx) {
  currentProductImages = currentProductImages.filter((_, i) => i !== idx);
  renderImagePreviews(currentProductImages);
}

// ── INVENTORY ──
function renderInventory() {
  const all = cache.products;
  const oos = all.filter(p => parseInt(p.qty || 0) === 0).length;
  const low = all.filter(p => parseInt(p.qty || 0) > 0 && parseInt(p.qty || 0) <= 5).length;
  const totalVal = all.reduce((a, p) => a + parseFloat(p.buy_price || p.price || 0) * parseInt(p.qty || 0), 0);

  document.getElementById('inv-stats').innerHTML = `
    <div class="stat-card orange"><div class="stat-val">${all.length}</div><div class="stat-label">Total Products</div></div>
    <div class="stat-card red"><div class="stat-val">${oos}</div><div class="stat-label">Out of Stock</div></div>
    <div class="stat-card blue"><div class="stat-val">${low}</div><div class="stat-label">Low Stock ≤5</div></div>
    <div class="stat-card green"><div class="stat-val">EGP ${fmt(totalVal)}</div><div class="stat-label">Inventory Value</div></div>`;

  // Filter by product code or name (case-insensitive, trimmed).
  const q = (document.getElementById('inv-search')?.value || '').trim().toLowerCase();
  const ps = q
    ? all.filter(p => String(p.code || '').toLowerCase().includes(q) || String(p.name || '').toLowerCase().includes(q))
    : all;

  document.getElementById('inv-tbody').innerHTML = ps.length ? ps.map(p => {
    // categories can be array or string
    const cats = Array.isArray(p.categories) ? p.categories : (p.category ? [p.category] : []);
    const isOffer = p.is_offer && p.offer_price;
    return `
    <tr>
      <td><span class="badge b-orange">${esc(p.code)}</span></td>
      <td>
        <strong>${esc(p.name)}</strong>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">
          ${cats.map(c => `<span class="badge b-info" style="font-size:10px">${esc(CAT_LABELS[c] || c)}</span>`).join('')}
          ${p.brand ? `<span class="badge b-gray" style="font-size:10px">${esc(p.brand)}</span>` : ''}
          ${isOffer ? `<span class="badge b-danger" style="font-size:10px">🔥 EGP ${fmt(p.offer_price)}</span>` : ''}
          ${!p.is_published ? `<span class="badge b-gray" style="font-size:10px">Hidden</span>` : ''}
        </div>
      </td>
      <td><span class="badge ${parseInt(p.qty || 0) === 0 ? 'b-danger' : parseInt(p.qty || 0) <= 5 ? 'b-warning' : 'b-success'}">${p.qty}</span></td>
      <td>EGP ${fmt(p.buy_price || 0)}</td>
      <td>EGP ${fmt(p.price)}</td>
      <td><div class="actions">
        <button class="btn btn-ghost btn-xs" onclick="editProduct('${p.id}')">Edit</button>
        <button class="btn btn-danger btn-xs" onclick="delProduct('${p.id}')">Remove</button>
      </div></td>
    </tr>`;
  }).join('') : `<tr><td colspan="6"><div class="empty"><div class="empty-icon">📦</div>${q ? `لا توجد منتجات مطابقة لـ "${esc(q)}"` : 'No products yet. Add your first product.'}</div></td></tr>`;
}

// ── OFFER TOGGLE ──
function toggleOfferPrice() {
  const cb = document.getElementById('p-is-offer');
  const row = document.getElementById('p-offer-row');
  if (cb && row) row.style.display = cb.checked ? 'block' : 'none';
  if (!cb.checked) {
    const prev = document.getElementById('p-offer-preview');
    if (prev) prev.textContent = '';
  }
}

function updateDiscountPreview() {
  const price = parseFloat(document.getElementById('p-price')?.value || 0);
  const offer = parseFloat(document.getElementById('p-offer-price')?.value || 0);
  const prev = document.getElementById('p-offer-preview');
  if (!prev) return;
  if (offer > 0 && price > 0 && offer < price) {
    const pct = Math.round((1 - offer / price) * 100);
    prev.textContent = `Save ${pct}% off the original price of EGP ${fmt(price)}`;
  } else if (offer >= price && price > 0) {
    prev.textContent = 'Offer price should be less than the original price';
    prev.style.color = '#e53e3e';
  } else {
    prev.textContent = '';
  }
}

// ── PRODUCT CRUD ──
function openAddProduct() {
  currentProductImages = [];
  showModal('tpl-product');
  setTimeout(() => {
    document.getElementById('p-code').value = '';
    document.getElementById('p-name').value = '';
    document.getElementById('p-qty').value = '';
    document.getElementById('p-price').value = '';
    document.getElementById('p-buy-price').value = '';
    document.getElementById('p-brand').value = '';
    document.getElementById('p-description').value = '';
    document.getElementById('p-is-offer').checked = false;
    document.getElementById('p-offer-price').value = '';
    document.getElementById('p-offer-row').style.display = 'none';
    document.getElementById('p-is-published').checked = true;
    document.querySelectorAll('.p-cat-cb').forEach(cb => cb.checked = false);
    document.getElementById('p-idx').value = '';
    document.getElementById('m-product-title').textContent = 'Add Product';
    renderImagePreviews([]);
  }, 80);
}

function editProduct(id) {
  const p = cache.products.find(x => x.id === id);
  if (!p) return;
  currentProductImages = Array.isArray(p.images) ? [...p.images] : [];
  showModal('tpl-product');
  setTimeout(() => {
    document.getElementById('p-code').value = p.code;
    document.getElementById('p-name').value = p.name;
    document.getElementById('p-qty').value = p.qty;
    document.getElementById('p-price').value = p.price;
    document.getElementById('p-buy-price').value = p.buy_price || '';
    document.getElementById('p-brand').value = p.brand || '';
    document.getElementById('p-description').value = p.description || '';
    document.getElementById('p-is-offer').checked = !!p.is_offer;
    document.getElementById('p-offer-price').value = p.offer_price || '';
    document.getElementById('p-offer-row').style.display = p.is_offer ? 'block' : 'none';
    document.getElementById('p-is-published').checked = p.is_published !== false;
    const cats = Array.isArray(p.categories) ? p.categories : (p.category ? [p.category] : []);
    document.querySelectorAll('.p-cat-cb').forEach(cb => { cb.checked = cats.includes(cb.value); });
    document.getElementById('p-idx').value = id;
    document.getElementById('m-product-title').textContent = 'Edit Product';
    renderImagePreviews(currentProductImages);
  }, 80);
}

async function saveProduct() {
  const code = document.getElementById('p-code').value.trim();
  const name = document.getElementById('p-name').value.trim();
  const qty = parseInt(document.getElementById('p-qty').value || 0);
  const price = parseFloat(document.getElementById('p-price').value || 0);
  const buy_price = parseFloat(document.getElementById('p-buy-price').value || 0);
  const brand = document.getElementById('p-brand').value || null;
  const description = document.getElementById('p-description').value.trim() || null;
  const is_offer = document.getElementById('p-is-offer').checked;
  const offer_price = is_offer ? (parseFloat(document.getElementById('p-offer-price').value || 0) || null) : null;
  const is_published = document.getElementById('p-is-published').checked;
  const categories = Array.from(document.querySelectorAll('.p-cat-cb:checked')).map(cb => cb.value);
  // Keep first category in 'category' field for backward compatibility with store
  const category = categories[0] || null;

  if (!code || !name) { showToast('Please fill in code and name'); return; }
  if (is_offer && !offer_price) { showToast('Please enter the discounted price'); return; }

  const id = document.getElementById('p-idx').value;
const payload = { code, name, qty, price, buy_price, brand, description, is_offer, offer_price, is_published, categories, category, images: currentProductImages };
  try {
    if (id) {
      await dbUpdate('products', id, payload);
      const i = cache.products.findIndex(x => x.id === id);
      if (i >= 0) cache.products[i] = { ...cache.products[i], ...payload };
      showToast('Product updated ✓');
    } else {
      const data = { id: genId(), ...payload, created_at: new Date().toISOString() };
      await dbInsert('products', data);
      cache.products.push(data);
      showToast('Product added ✓');
    }
    closeModal(); renderAll();
  } catch (e) { showToast('Error: ' + e.message); }
}

async function delProduct(id) {
  if (!confirm('Remove this product permanently?')) return;
  try {
    await dbDelete('products', id);
    cache.products = cache.products.filter(x => x.id !== id);
    showToast('Product removed'); renderAll();
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── ORDERS ──
function renderOrders() {
  const prevCount = parseInt(sessionStorage.getItem("protech_order_count") || "0");
  const newCount = cache.orders.length;
  if (newCount > prevCount && prevCount !== 0) {
    playNotificationSound();
    showToast("🛒 طلب جديد وصل!");
  }
  sessionStorage.setItem("protech_order_count", newCount);
  const smap = { 'Processing': 'b-info', 'In Transit': 'b-warning', 'Delivered': 'b-success', 'On its way to me': 'b-purple', 'Returned': 'b-purple', 'Cancelled': 'b-danger', 'Awaiting Action': 'b-danger' };
  document.getElementById('orders-tbody').innerHTML = cache.orders.length ? cache.orders.map(o => `
    <tr${o.status === 'Awaiting Action' ? ' style="background:#fff4f4"' : ''}>
      <td><span class="badge b-orange">${esc(o.code)}</span> ${orderProgressBadge(o)}${o.allow_open ? ' <span class="badge b-warning" title="يريد فتح الشحنة">📦</span>' : ''}${o.status === 'Returned' && !o.warehouse_confirmed ? ' <span class="badge b-danger" title="مرتجع — لم يُرجع للمخزن بعد">↩️ لم يُرجع للمخزن</span>' : ''}</td>
      <td><strong>${esc(o.customer_name)}</strong></td>
      <td>${esc(o.phone)}</td>
      <td>EGP ${fmt(o.total)}</td>
      <td>${o.status === 'Awaiting Action'
        ? `<span style="display:inline-block;background:#dc2626;color:#fff;font-weight:800;font-size:13px;padding:6px 12px;border-radius:8px;animation:none">⚠️ AWAITING ACTION</span>`
        : `<span class="badge ${smap[o.status] || 'b-gray'}">${esc(o.status)}</span>`}${
          o.customer_confirmed === true ? `<div style="font-size:11px;color:#16a34a;font-weight:700;margin-top:3px">✅ مؤكد</div>`
          : o.customer_confirmed === false ? `<div style="font-size:11px;color:#dc2626;font-weight:700;margin-top:3px">❌ ملغي</div>`
          : ''}${o.allow_open ? `<div style="font-size:11px;color:#F26A21;font-weight:700;margin-top:3px">📦 فتح الشحنة</div>` : ''}</td>
      <td><div class="actions">
        <button class="btn btn-ghost btn-xs" onclick="viewOrder('${o.id}')">View</button>
        <button class="btn btn-dark btn-xs" onclick="editOrder('${o.id}')">Edit</button>
        <button class="btn btn-danger btn-xs" onclick="delOrder('${o.id}')">Delete</button>
      </div></td>
    </tr>`).join('') : '<tr><td colspan="6"><div class="empty"><div class="empty-icon">🛒</div>No orders yet</div></td></tr>';
}

async function syncFromBosta() {
  showToast('Syncing from Bosta…');
  try {
    const res = await fetch('/api/sync-status', { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'sync failed');
    await loadAll();
    showToast(`Synced ✓ ${d.updated || 0} order(s) updated`);
    if (d.unknownStates && d.unknownStates.length) {
      console.warn('Bosta states not mapped yet:', d.unknownStates);
    }
  } catch (e) { showToast('Sync error: ' + e.message); }
}

let oPRows = [];

function openCreateOrder() {
  oPRows = [{ code: '', qty: 1, sell_price: '', buy_price: '' }];
  ['o-name', 'o-phone', 'o-shipcode', 'o-shipest'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('o-idx').value = '';
  document.getElementById('m-order-title').textContent = 'New Order';
  renderPRows(); showModal('tpl-order');
}

function editOrder(id) {
  const o = cache.orders.find(x => x.id === id);
  if (!o) return;
  oPRows = (o.products || [{ code: '', qty: 1, sell_price: '' }]).map(p => ({ ...p }));
  showModal('tpl-order');
  setTimeout(() => {
    document.getElementById('o-name').value = o.customer_name;
    document.getElementById('o-phone').value = o.phone;
    document.getElementById('o-shipcode').value = o.ship_code || '';
    document.getElementById('o-shipest').value = o.est_shipping || '';
    document.getElementById('o-idx').value = id;
    document.getElementById('m-order-title').textContent = 'Edit Order — ' + o.customer_name;
    renderPRows();
    const shipInput = document.getElementById('o-shipcode');
    if (shipInput) {
      shipInput.style.border = '2px solid #F26A21';
      shipInput.style.background = '#fff8f3';
      shipInput.focus();
      shipInput.oninput = () => updateSendShipBtn(id);
    }
    updateSendShipBtn(id);
  }, 80);
}

function addProdRow() { oPRows.push({ code: '', qty: 1, sell_price: '', buy_price: '' }); renderPRows(); }
function removePRow(i) { oPRows.splice(i, 1); renderPRows(); }
function updatePRow(i, f, v) { oPRows[i][f] = v; calcTotal(); }

function renderPRows() {
  document.getElementById('o-products').innerHTML = oPRows.map((r, i) => `
    <div class="op-row">
      <div class="op-row-grid">
        <div class="form-group" style="margin:0"><label>Product</label>
          <select onchange="updatePRow(${i},'code',this.value)">
            <option value="">Select product</option>
            ${cache.products.map(p => `<option value="${esc(p.code)}"${r.code === p.code ? ' selected' : ''}>${esc(p.name)} (${esc(p.code)})</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0"><label>Qty</label>
          <input type="number" min="1" value="${r.qty}" inputmode="numeric" onchange="updatePRow(${i},'qty',this.value)">
        </div>
        <div class="form-group" style="margin:0"><label>Sell Price</label>
          <input type="number" min="0" value="${r.sell_price}" placeholder="0" inputmode="decimal" onchange="updatePRow(${i},'sell_price',this.value)">
        </div>
        <div class="form-group" style="margin:0"><label>Buy Price</label>
          <input type="number" min="0" value="${r.buy_price ?? ''}" placeholder="${fmt(cache.products.find(p => p.code === r.code)?.buy_price || 0)}" inputmode="decimal" onchange="updatePRow(${i},'buy_price',this.value)">
        </div>
        ${oPRows.length > 1 ? `<button class="btn btn-danger btn-xs" style="margin-bottom:2px" onclick="removePRow(${i})">✕</button>` : '<div></div>'}
      </div>
    </div>`).join('');
  calcTotal();
  const shipInput = document.getElementById('o-shipest');
  if (shipInput) shipInput.oninput = calcTotal;
}

function calcTotal() {
  const estShip = parseFloat(document.getElementById('o-shipest')?.value || 0);
  const t = oPRows.reduce((a, r) => a + parseFloat(r.sell_price || 0) * parseInt(r.qty || 1), 0);
  document.getElementById('o-total-disp').textContent = fmt(t + estShip) + ' EGP';
}

async function saveOrder() {
  const customer_name = document.getElementById('o-name').value.trim();
  const phone = document.getElementById('o-phone').value.trim();
  const ship_code = document.getElementById('o-shipcode').value.trim();
  const est_shipping = parseFloat(document.getElementById('o-shipest').value || 0);
  if (!customer_name || !phone) { showToast('Please enter customer name and phone'); return; }
  if (!phoneOk(phone)) { showToast('Invalid Egyptian phone number (e.g. 01208198008)'); return; }

  for (const r of oPRows) {
    if (!r.code) continue;
    const prod = cache.products.find(p => p.code === r.code);
    if (!prod) { showToast('Product not found: ' + r.code); return; }
    if (parseInt(r.qty || 1) > parseInt(prod.qty || 0)) {
      showToast(`Not enough stock for "${prod.name}" — available: ${prod.qty}`);
      return;
    }
  }

  const total = oPRows.reduce((a, r) => a + parseFloat(r.sell_price || 0) * parseInt(r.qty || 1), 0) + est_shipping;
  // Snapshot the buy price onto each line so the Elashry-owed figure stays fixed at the
  // price paid when the order was placed, even if the product's buy price changes later.
  const lineItems = oPRows.map(r => ({
    ...r,
    // Use the buy price typed for this line; if left blank, fall back to the product's
    // current buy price. This is a per-order snapshot — editing it here does not change
    // the product's system-wide buy price.
    buy_price: (r.buy_price !== '' && r.buy_price != null)
      ? parseFloat(r.buy_price) || 0
      : parseFloat(cache.products.find(p => p.code === r.code)?.buy_price || 0),
  }));
  const id = document.getElementById('o-idx').value;
  try {
    if (id) {
      const oldOrder = cache.orders.find(x => x.id === id);
      if (oldOrder && oldOrder.products) {
        for (const op of oldOrder.products) {
          const prod = cache.products.find(p => p.code === op.code);
          if (prod) {
            const restored = parseInt(prod.qty || 0) + parseInt(op.qty || 1);
            const pi = cache.products.findIndex(p => p.code === op.code);
            cache.products[pi].qty = restored;
            await dbUpdate('products', prod.id, { qty: restored });
          }
        }
      }
      const upd = { customer_name, phone, ship_code, est_shipping, products: lineItems, total };
      await dbUpdate('orders', id, upd);
      const i = cache.orders.findIndex(x => x.id === id);
      if (i >= 0) cache.orders[i] = { ...cache.orders[i], ...upd };
      showToast('Order updated ✓');
    } else {
      const data = {
        id: genId(), code: genCode('ORD'), customer_name, phone, ship_code, est_shipping,
        products: lineItems, total, status: 'Processing', date: today(),
        actual_shipping: 0, cancel_reason: '', created_at: new Date().toISOString()
      };
      await dbInsert('orders', data);
      cache.orders.unshift(data);
      showToast('Order created ✓');
    }

    for (const r of oPRows) {
      if (!r.code) continue;
      const pi = cache.products.findIndex(p => p.code === r.code);
      if (pi >= 0) {
        const newQty = Math.max(0, parseInt(cache.products[pi].qty || 0) - parseInt(r.qty || 1));
        cache.products[pi].qty = newQty;
        await dbUpdate('products', cache.products[pi].id, { qty: newQty });
      }
    }
    closeModal(); renderAll();
  } catch (e) { showToast('Error: ' + e.message); }
}

async function delOrder(id) {
  if (!confirm('Delete this order permanently?')) return;
  try {
    await dbDelete('orders', id);
    cache.orders = cache.orders.filter(x => x.id !== id);
    showToast('Order deleted'); renderAll();
  } catch (e) { showToast('Error: ' + e.message); }
}

async function confirmWarehouse(id) {
  if (!confirm('Confirm you have received this order back in your warehouse?')) return;
  const order = cache.orders.find(x => x.id === id);
  if (!order) return;
  try {
    for (const op of (order.products || [])) {
      const pi = cache.products.findIndex(p => p.code === op.code);
      if (pi >= 0) {
        const restored = parseInt(cache.products[pi].qty || 0) + parseInt(op.qty || 1);
        cache.products[pi].qty = restored;
        await dbUpdate('products', cache.products[pi].id, { qty: restored });
      }
    }
    await dbUpdate('orders', id, { warehouse_confirmed: true });
    const i = cache.orders.findIndex(x => x.id === id);
    if (i >= 0) cache.orders[i].warehouse_confirmed = true;
    showToast('Stock restored to inventory ✓');
    closeModal(); renderAll();
  } catch (e) { showToast('Error: ' + e.message); }
}

// Undo a warehouse confirmation: remove the stock that was added back and mark the
// order as not-yet-received (so it counts as owed again).
async function undoWarehouse(id) {
  if (!confirm('Undo "received in warehouse"? This removes the restored stock and marks it as not yet received.')) return;
  const order = cache.orders.find(x => x.id === id);
  if (!order) return;
  try {
    for (const op of (order.products || [])) {
      const pi = cache.products.findIndex(p => p.code === op.code);
      if (pi >= 0) {
        const newQty = Math.max(0, parseInt(cache.products[pi].qty || 0) - parseInt(op.qty || 1));
        cache.products[pi].qty = newQty;
        await dbUpdate('products', cache.products[pi].id, { qty: newQty });
      }
    }
    await dbUpdate('orders', id, { warehouse_confirmed: false });
    const i = cache.orders.findIndex(x => x.id === id);
    if (i >= 0) cache.orders[i].warehouse_confirmed = false;
    showToast('Reverted — marked as not yet received');
    closeModal(); renderAll();
  } catch (e) { showToast('Error: ' + e.message); }
}

// Update the per-order buy-price snapshot only (does not touch stock, sell prices,
// totals, or the product's system-wide buy price).
async function saveOrderBuyPrices(id) {
  const o = cache.orders.find(x => x.id === id);
  if (!o) return;
  const newProducts = (o.products || []).map((p, idx) => {
    const el = document.getElementById('bp-' + idx);
    const v = el ? el.value : '';
    const bp = (v !== '' && v != null) ? (parseFloat(v) || 0) : lineBuyPrice(p, cache.products);
    return { ...p, buy_price: bp };
  });
  try {
    await dbUpdate('orders', id, { products: newProducts });
    const i = cache.orders.findIndex(x => x.id === id);
    if (i >= 0) cache.orders[i].products = newProducts;
    showToast('Buy prices updated for this order ✓');
    renderAll();
  } catch (e) { showToast('Error: ' + e.message); }
}

function viewOrder(id) {
  const o = cache.orders.find(x => x.id === id);
  if (!o) return;
  const statuses = ['Processing', 'In Transit', 'Delivered', 'On its way to me', 'Returned', 'Awaiting Action', 'Cancelled'];
  const prHtml = (o.products || []).map((p, idx) => {
    const pr = cache.products.find(pp => pp.code === p.code);
    const unitPrice = parseFloat(p.sell_price ?? p.price ?? 0);
    const line = unitPrice * parseInt(p.qty || 1);
    const bp = lineBuyPrice(p, cache.products);
    return `<tr><td>${esc(pr?.name || p.name || p.code)}</td><td style="text-align:center">${p.qty}</td><td>EGP ${fmt(unitPrice)}</td><td>EGP ${fmt(line)}</td><td style="text-align:center"><input type="number" min="0" id="bp-${idx}" value="${bp}" style="width:88px;padding:5px 6px" inputmode="decimal"></td></tr>`;
  }).join('');
  const feedbackUrl = `${window.location.origin}/feedback.html?order=${o.code}`;
  const waText = encodeURIComponent(`أهلاً ${o.customer_name} 😊\nشكراً لتسوقك من بروتيك! 🔧\n\nنرجو منك تقييم تجربتك:\n${feedbackUrl}\n\nرأيك يهمنا 🙏`);
  const waPhone = o.phone.startsWith('0') ? '2' + o.phone : o.phone;
  const waLink = `https://wa.me/${waPhone}?text=${waText}`;

  // Manual order-confirmation message (no API): opens WhatsApp with a pre-filled
  // request asking the customer to reply تأكيد / إلغاء. You then record their reply
  // with the ✅ / ❌ buttons below.
  const confirmProducts = Array.isArray(o.products)
    ? o.products.map(p => `• ${p.name || p.code} × ${p.qty || 1} — ${((p.sell_price || p.price || 0) * (p.qty || 1)).toLocaleString('ar-EG')} ج.م`).join('\n')
    : '';
  const confirmText = encodeURIComponent(
`مرحباً ${o.customer_name}

شكراً لطلبك من *بروتيك*
تم تجهيز طلبك وجاري الشحن.

*تفاصيل الطلب:*
${confirmProducts}

رسوم الشحن: ${o.est_shipping || 0} ج.م
*الإجمالي الكلي: ${o.total || 0} ج.م*

فتح الشحنة قبل الاستلام: ${o.allow_open ? 'متاح' : 'غير متاح'}

*كود الشحن: ${o.ship_code || 'سيتم إرساله قريباً'}*
تتبع شحنتك: https://bosta.co/en-eg/tracking-shipments

بروتيك — الشغل عليك والعدة علينا
protechstores.com

برجاء تأكيد الطلب بإرسال كلمة *تأكيد* في رسالة`
  );
  const confirmLink = `https://wa.me/${waPhone}?text=${confirmText}`;
  const cc = o.customer_confirmed;
  const ccBadge = cc === true
    ? `<span style="color:#16a34a;font-weight:800;font-size:13px;display:inline-flex;align-items:center;gap:6px">✅ العميل أكد الحجز</span>`
    : cc === false
    ? `<span style="color:#dc2626;font-weight:800;font-size:13px;display:inline-flex;align-items:center;gap:6px">❌ العميل ألغى الحجز</span>`
    : `<span style="color:#92702a;font-weight:700;font-size:13px;display:inline-flex;align-items:center;gap:6px">⏳ بانتظار تأكيد العميل</span>`;

  document.getElementById('m-detail-body').innerHTML = `
    ${o.status === 'Awaiting Action' ? `<div style="background:#dc2626;color:#fff;font-weight:800;font-size:16px;text-align:center;padding:14px;border-radius:10px;margin-bottom:14px">⚠️ هذا الطلب يحتاج إجراء — AWAITING ACTION</div>` : ''}
    <div id="order-tracker-${id}" style="background:#fafafa;border:1px solid #eee;border-radius:10px;padding:14px;margin-bottom:16px;display:flex;justify-content:center">
      ${orderTrackerHTML(o)}
    </div>
    <div class="detail-grid">
      <div><div class="detail-label">Order Code</div><strong>${esc(o.code)}</strong></div>
      <div><div class="detail-label">Date</div>${esc(o.date)}</div>
      <div><div class="detail-label">Customer</div><strong>${esc(o.customer_name)}</strong></div>
      <div><div class="detail-label">Phone</div>${esc(o.phone)}</div>
      <div><div class="detail-label">City</div><strong>${esc(o.city) || '—'}</strong></div>
      <div><div class="detail-label">Address</div>${esc(o.address) || '—'}</div>
      <div><div class="detail-label">Shipping Code</div>${esc(o.ship_code) || '—'}</div>
      <div><div class="detail-label">Est. Shipping</div>EGP ${fmt(o.est_shipping || 0)}</div>
      <div style="grid-column:1/-1"><div class="detail-label">Open Package — فتح الشحنة</div>
        <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-weight:700">
          <input type="checkbox" id="d-allowopen" ${o.allow_open ? 'checked' : ''} style="width:18px;height:18px;accent-color:#F26A21">
          <span>📦 العميل يريد فتح الشحنة قبل الاستلام</span>
        </label></div>
      ${o.notes ? `<div style="grid-column:1/-1"><div class="detail-label">Notes</div>${esc(o.notes)}</div>` : ''}
    </div>
    <div class="table-wrap" style="margin-bottom:8px">
      <table>
        <thead><tr><th>Product</th><th style="text-align:center">Qty</th><th>Unit Price</th><th>Subtotal</th><th style="text-align:center">Buy Price</th></tr></thead>
        <tbody>${prHtml}</tbody>
      </table>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-bottom:16px">
      <button class="btn btn-ghost btn-sm" onclick="saveOrderBuyPrices('${id}')">💾 Save buy prices (this order only)</button>
    </div>
    <div style="text-align:right;font-weight:800;font-size:15px;color:var(--orange);margin-bottom:16px">Order Total: EGP ${fmt(o.total)}</div>
    <div class="form-row">
      <div class="form-group"><label>Actual Shipping Cost (EGP)</label><input type="number" id="d-ship" value="${o.actual_shipping || ''}" placeholder="0" inputmode="decimal"></div>
      <div class="form-group"><label>Cancellation Reason</label><input id="d-reason" value="${esc(o.cancel_reason)}" placeholder="If applicable"></div>
    </div>
    <div class="form-group"><label>Order Status</label>
      <select id="d-status">${statuses.map(s => `<option${o.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select>
    </div>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px;margin:6px 0 14px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <span style="font-weight:800;font-size:13px;color:#166534">تأكيد الطلب عبر واتساب</span>
      ${ccBadge}
      <div style="flex-basis:100%;height:0"></div>
      <a href="${confirmLink}" target="_blank"
        style="display:inline-flex;align-items:center;gap:8px;background:#25D366;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">
        📲 إرسال طلب التأكيد
      </a>
      <button class="btn" style="background:#16a34a;color:#fff" onclick="setConfirm('${id}',true)">✅ تم التأكيد</button>
      <button class="btn" style="background:#dc2626;color:#fff" onclick="setConfirm('${id}',false)">❌ تم الإلغاء</button>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
      <button class="btn btn-primary" onclick="saveDetail('${id}')">Save Changes</button>
      ${o.status === 'Delivered' ? `<a href="${waLink}" target="_blank" class="btn btn-wa" onclick="markFeedbackSent('${id}')">WhatsApp Feedback</a>` : ''}
      ${o.status === 'Delivered' ? `<button class="btn btn-ghost" onclick="openFeedback('${o.code}')">Add Manual Feedback</button>` : ''}
      ${(o.status === 'Cancelled' || o.status === 'Returned') && !o.warehouse_confirmed ? `
        <button class="btn" style="background:#7c3aed;color:#fff;display:flex;align-items:center;gap:8px" onclick="confirmWarehouse('${id}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Confirm Received in Warehouse
        </button>` : ''}
      ${(o.status === 'Cancelled' || o.status === 'Returned') && o.warehouse_confirmed ? `<span style="color:#16a34a;font-size:13px;font-weight:700;display:flex;align-items:center;gap:6px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Stock Returned to Inventory</span>
        <button class="btn btn-ghost btn-xs" onclick="undoWarehouse('${id}')">Undo</button>` : ''}
    </div>`;
  showModal('tpl-detail');
}

async function saveDetail(id) {
  const cancel_reason = document.getElementById('d-reason').value;
  const status = document.getElementById('d-status').value;
  const allow_open = !!document.getElementById('d-allowopen')?.checked;
  // Cancelled = cancelled before shipping, so there is no shipping cost.
  const actual_shipping = status === 'Cancelled' ? 0 : parseFloat(document.getElementById('d-ship').value || 0);
  try {
    await dbUpdate('orders', id, { actual_shipping, cancel_reason, status, allow_open });
    const i = cache.orders.findIndex(x => x.id === id);
    if (i >= 0) cache.orders[i] = { ...cache.orders[i], actual_shipping, cancel_reason, status, allow_open };
    showToast('Order updated ✓'); closeModal(); renderAll();
  } catch (e) { showToast('Error: ' + e.message); }
}

// Record the customer's reply to the manual WhatsApp confirmation request.
// confirmed=true  -> customer_confirmed=true
// confirmed=false -> customer_confirmed=false AND status -> Cancelled
async function setConfirm(id, confirmed) {
  const patch = confirmed ? { customer_confirmed: true } : { customer_confirmed: false, status: 'Cancelled' };
  try {
    await dbUpdate('orders', id, patch);
    const i = cache.orders.findIndex(x => x.id === id);
    if (i >= 0) cache.orders[i] = { ...cache.orders[i], ...patch };
    showToast(confirmed ? 'Order confirmed ✓' : 'Order cancelled ✗');
    closeModal(); renderAll();
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── RETURNS ──
function renderReturns() {
  // A return only counts once the order is explicitly set to "Returned".
  const rets = cache.orders.filter(o => o.status === 'Returned');
  const totalShip = rets.reduce((a, o) => a + parseFloat(o.actual_shipping || 0), 0);
  document.getElementById('ret-stats').innerHTML = `
    <div class="stat-card red"><div class="stat-val">${rets.length}</div><div class="stat-label">Total Returns</div></div>
    <div class="stat-card orange"><div class="stat-val">EGP ${fmt(totalShip)}</div><div class="stat-label">Total Return Shipping</div></div>`;
  document.getElementById('ret-tbody').innerHTML = rets.length ? rets.map(o => `
    <tr>
      <td><strong>${esc(o.customer_name)}</strong></td>
      <td>${esc(o.phone)}</td>
      <td>${esc(o.cancel_reason) || '—'}</td>
      <td>EGP ${fmt(o.actual_shipping || 0)}</td>
      <td>${esc(o.date)}</td>
    </tr>`).join('') : '<tr><td colspan="5"><div class="empty"><div class="empty-icon">↩️</div>No returns</div></td></tr>';
}

// ── FINANCIALS ──
function renderFinancials() {
  const orders = cache.orders;
  const delivered = orders.filter(o => o.status === 'Delivered');
  const returned = orders.filter(o => o.status === 'Returned');
  const totalCollected = delivered.reduce((a, o) => a + parseFloat(o.total || 0), 0);
  const totalActualShip = delivered.reduce((a, o) => a + parseFloat(o.actual_shipping || 0), 0);
  const netFromBosta = totalCollected - totalActualShip;
  const retShipCost = returned.reduce((a, o) => a + parseFloat(o.actual_shipping || 0), 0);
  const orderGoods = orders.filter(owesElashry).reduce((a, o) => a + (o.products || []).reduce((b, p) =>
    b + lineBuyPrice(p, cache.products) * parseInt(p.qty || 1), 0), 0);
  // Things bought from Elashry for Protech (logged as "Elashry" expenses) are part of the
  // Elashry cost, not generic expenses — fold them into buying cost and out of extra expenses.
  const elashryExp = cache.expenses.filter(e => e.category === 'Elashry').reduce((a, e) => a + parseFloat(e.amount || 0), 0);
  const buyingCost = orderGoods + elashryExp;
  const totalExp = cache.expenses.filter(e => e.category !== 'Elashry').reduce((a, e) => a + parseFloat(e.amount || 0), 0);
  const netProfit = netFromBosta - retShipCost - buyingCost - totalExp;

  // Projected scenario: assume every In-Transit order is delivered & paid in full, and all
  // Returned goods are restocked (so their cost is excluded). The true per-order "am I
  // winning?" once the pipeline clears.
  const projOrders = orders.filter(o => o.status === 'In Transit' || o.status === 'Delivered');
  const projRevenue = projOrders.reduce((a, o) => a + (parseFloat(o.total || 0) - parseFloat(o.actual_shipping || 0)), 0);
  const projCOGS = projOrders.reduce((a, o) => a + (o.products || []).reduce((b, p) => b + lineBuyPrice(p, cache.products) * parseInt(p.qty || 1), 0), 0);
  const allExpenses = cache.expenses.reduce((a, e) => a + parseFloat(e.amount || 0), 0);
  const projProfit = projRevenue - projCOGS - allExpenses - retShipCost;

  document.getElementById('fin-revenue').innerHTML = `
    <div class="fin-row"><span>Total collected (orders + shipping)</span><span class="fin-val">EGP ${fmt(totalCollected)}</span></div>
    <div class="fin-row"><span>Total actual shipping cost</span><span class="fin-val deduct">− EGP ${fmt(totalActualShip)}</span></div>
    <div class="fin-row subtotal"><span>Net amount from Bosta</span><span class="fin-val" style="color:var(--orange)">EGP ${fmt(netFromBosta)}</span></div>
    <div style="height:10px"></div>
    <div class="fin-row"><span>Return shipping cost</span><span class="fin-val deduct">− EGP ${fmt(retShipCost)}</span></div>
    <div class="fin-row"><span>Total Elashry cost (goods + purchases)</span><span class="fin-val deduct">− EGP ${fmt(buyingCost)}</span></div>`;

  document.getElementById('exp-tbody').innerHTML = cache.expenses.length ? cache.expenses.map(e => `
    <tr>
      <td><span class="badge b-orange">${esc(e.category)}</span></td>
      <td>${esc(e.description) || '—'}</td>
      <td>EGP ${fmt(e.amount)}</td>
      <td>${esc(e.date)}</td>
      <td><button class="btn btn-danger btn-xs" onclick="delExpense('${e.id}')">✕</button></td>
    </tr>`).join('') : '<tr><td colspan="5"><div class="empty">No expenses recorded</div></td></tr>';

  document.getElementById('fin-net').innerHTML = `
    <div class="fin-row"><span>Net from Bosta</span><span class="fin-val">EGP ${fmt(netFromBosta)}</span></div>
    <div class="fin-row"><span>Total Elashry cost (goods + purchases)</span><span class="fin-val deduct">− EGP ${fmt(buyingCost)}</span></div>
    <div class="fin-row"><span>Total extra expenses</span><span class="fin-val deduct">− EGP ${fmt(totalExp)}</span></div>
    <div class="fin-row"><span>Return shipping costs</span><span class="fin-val deduct">− EGP ${fmt(retShipCost)}</span></div>
    <div class="fin-row ${netProfit >= 0 ? 'profit' : 'loss'}"><span>${netProfit >= 0 ? '🟢 Net Profit' : '🔴 Net Loss'}</span><span>EGP ${fmt(Math.abs(netProfit))}</span></div>
    <div style="height:16px"></div>
    <div class="fin-row"><span style="font-weight:800;color:var(--orange)">Projected — if all In-Transit deliver & returns restocked</span></div>
    <div class="fin-row"><span>Projected revenue (delivered + in-transit, net of shipping)</span><span class="fin-val">EGP ${fmt(projRevenue)}</span></div>
    <div class="fin-row"><span>Cost of those goods (returns excluded)</span><span class="fin-val deduct">− EGP ${fmt(projCOGS)}</span></div>
    <div class="fin-row"><span>All expenses (ads, Elashry purchases, Bosta fees…)</span><span class="fin-val deduct">− EGP ${fmt(allExpenses)}</span></div>
    <div class="fin-row"><span>Return shipping</span><span class="fin-val deduct">− EGP ${fmt(retShipCost)}</span></div>
    <div class="fin-row ${projProfit >= 0 ? 'profit' : 'loss'}"><span>${projProfit >= 0 ? '🟢 Projected Profit' : '🔴 Projected Loss'}</span><span>EGP ${fmt(Math.abs(projProfit))}</span></div>`;
}

// ── EXPENSES ──
function openExpense(presetCategory) {
  showModal('tpl-expense');
  document.getElementById('e-desc').value = '';
  document.getElementById('e-amt').value = '';
  if (presetCategory) { const el = document.getElementById('e-cat'); if (el) el.value = presetCategory; }
}

async function saveExpense() {
  const category = document.getElementById('e-cat').value;
  const description = document.getElementById('e-desc').value.trim();
  const amount = parseFloat(document.getElementById('e-amt').value || 0);
  if (!amount) { showToast('Please enter an amount'); return; }
  try {
    const data = { id: genId(), category, description, amount, date: today(), created_at: new Date().toISOString() };
    await dbInsert('expenses', data);
    cache.expenses.unshift(data);
    showToast('Expense saved ✓'); closeModal(); renderAll();
  } catch (e) { showToast('Error: ' + e.message); }
}

async function delExpense(id) {
  if (!confirm('Delete this expense?')) return;
  try {
    await dbDelete('expenses', id);
    cache.expenses = cache.expenses.filter(x => x.id !== id);
    showToast('Expense deleted'); renderAll();
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── INVOICES ──
function renderInvoices() {
  document.getElementById('inv-orders-tbody').innerHTML = cache.orders.length ? cache.orders.map(o => `
    <tr>
      <td><span class="badge b-orange">${esc(o.code)}</span></td>
      <td>${esc(o.customer_name)}</td>
      <td>EGP ${fmt(o.total)}</td>
      <td><span class="badge b-info">${esc(o.status)}</span></td>
      <td><button class="btn btn-primary btn-sm" onclick="printInvoice('${o.id}')">Print PDF</button></td>
    </tr>`).join('') : '<tr><td colspan="5"><div class="empty"><div class="empty-icon">🧾</div>No orders to print</div></td></tr>';
}

// ── FEEDBACK ──
function openFeedback(code) {
  closeModal();
  setTimeout(() => {
    document.getElementById('fb-code').value = code;
    showModal('tpl-feedback');
  }, 200);
}

async function saveFeedback() {
  const data = {
    id: genId(),
    order_code: document.getElementById('fb-code').value,
    service: document.getElementById('fb-service').value,
    general: document.getElementById('fb-general').value,
    recommend: document.getElementById('fb-rec').value,
    quality: document.getElementById('fb-quality').value,
    delivery: document.getElementById('fb-delivery').value,
    packing: document.getElementById('fb-packing').value,
    comment: document.getElementById('fb-comment').value.trim(),
    created_at: new Date().toISOString()
  };
  try {
    await dbInsert('feedbacks', data);
    cache.feedbacks.unshift(data);
    showToast('Feedback saved ✓'); closeModal(); renderAll();
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── MODAL SYSTEM ──
function showModal(tplId) {
  const tpl = document.getElementById(tplId);
  if (!tpl) return;
  const overlay = document.getElementById('overlay');
  overlay.innerHTML = tpl.innerHTML;
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('overlay').style.display = 'none';
  document.getElementById('overlay').innerHTML = '';
  document.body.style.overflow = '';
}

function overlayClick(e) {
  if (e.target === document.getElementById('overlay')) closeModal();
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
// ── EXCEL DOWNLOADS (SheetJS) ──────────────────────────────────────────

function downloadInventoryExcel() {
  const rows = cache.products.map(p => {
    const cats = Array.isArray(p.categories) ? p.categories.map(c => CAT_LABELS[c] || c).join(', ') : (CAT_LABELS[p.category] || p.category || '');
    return {
      'Product Code': p.code || '',
      'Product Name': p.name || '',
      'Brand': p.brand || '',
      'Categories': cats,
      'Quantity': parseInt(p.qty || 0),
      'Buy Price (EGP)': parseFloat(p.buy_price || 0),
      'Sell Price (EGP)': parseFloat(p.price || 0),
      'Offer Price (EGP)': p.is_offer ? parseFloat(p.offer_price || 0) : '',
      'Published': p.is_published !== false ? 'Yes' : 'No',
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 14 }, { wch: 40 }, { wch: 12 }, { wch: 30 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  XLSX.writeFile(wb, `Protech_Inventory_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast('Inventory Excel downloaded ✓');
}

function downloadOrdersExcel() {
  const now = new Date();
  const monthName = now.toLocaleString('en', { month: 'long', year: 'numeric' });
  const rows = cache.orders.map(o => {
    const products = Array.isArray(o.products)
      ? o.products.map(p => `${p.name || p.code} ×${p.qty || 1} @${p.sell_price || p.price || 0}`).join(' | ')
      : '';
    return {
      'Order Code': o.code || '',
      'Date': o.date || '',
      'Shipping Code': o.ship_code || '',
      'Customer Name': o.customer_name || '',
      'Phone': o.phone || '',
      'City': o.city || '',
      'Status': o.status || '',
      'Products': products,
      'Subtotal (EGP)': parseFloat(o.total || 0) - parseFloat(o.est_shipping || 0),
      'Shipping (EGP)': parseFloat(o.est_shipping || 0),
      'Total (EGP)': parseFloat(o.total || 0),
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 50 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Orders');
  XLSX.writeFile(wb, `Protech_Orders_${monthName.replace(' ', '_')}.xlsx`);
  showToast('Orders Excel downloaded ✓');
}

function downloadReturnsExcel() {
  const rets = cache.orders.filter(o => o.status === 'Returned');
  const rows = rets.map(o => {
    const products = Array.isArray(o.products)
      ? o.products.map(p => `${p.name || p.code} ×${p.qty || 1} @${p.sell_price || p.price || 0}`).join(' | ')
      : '';
    return {
      'Order Code': o.code || '',
      'Date': o.date || '',
      'Shipping Code': o.ship_code || '',
      'Customer Name': o.customer_name || '',
      'Phone': o.phone || '',
      'City': o.city || '',
      'Cancel Reason': o.cancel_reason || '',
      'Products': products,
      'Order Total (EGP)': parseFloat(o.total || 0),
      'Est. Shipping (EGP)': parseFloat(o.est_shipping || 0),
      'Actual Shipping (EGP)': parseFloat(o.actual_shipping || 0),
      'Warehouse Confirmed': o.warehouse_confirmed ? 'Yes' : 'No',
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 50 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Returns');
  XLSX.writeFile(wb, `Protech_Returns_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast('Returns Excel downloaded ✓');
}

function downloadFinancialsExcel() {
  const orders = cache.orders;
  const delivered = orders.filter(o => o.status === 'Delivered');
  const returned = orders.filter(o => o.status === 'Returned');
  const totalCollected = delivered.reduce((a, o) => a + parseFloat(o.total || 0), 0);
  const totalActualShip = delivered.reduce((a, o) => a + parseFloat(o.actual_shipping || 0), 0);
  const netFromBosta = totalCollected - totalActualShip;
  const retShipCost = returned.reduce((a, o) => a + parseFloat(o.actual_shipping || 0), 0);
  const orderGoods = orders.filter(owesElashry).reduce((a, o) => a + (o.products || []).reduce((b, p) =>
    b + lineBuyPrice(p, cache.products) * parseInt(p.qty || 1), 0), 0);
  // Things bought from Elashry for Protech (logged as "Elashry" expenses) are part of the
  // Elashry cost, not generic expenses — fold them into buying cost and out of extra expenses.
  const elashryExp = cache.expenses.filter(e => e.category === 'Elashry').reduce((a, e) => a + parseFloat(e.amount || 0), 0);
  const buyingCost = orderGoods + elashryExp;
  const totalExp = cache.expenses.filter(e => e.category !== 'Elashry').reduce((a, e) => a + parseFloat(e.amount || 0), 0);
  const netProfit = netFromBosta - retShipCost - buyingCost - totalExp;

  // Sheet 1: P&L Summary
  const summaryRows = [
    { 'Item': 'Total collected (orders + shipping)', 'Amount (EGP)': totalCollected },
    { 'Item': 'Total actual shipping cost', 'Amount (EGP)': -totalActualShip },
    { 'Item': 'Net amount from Bosta', 'Amount (EGP)': netFromBosta },
    { 'Item': '', 'Amount (EGP)': '' },
    { 'Item': 'Return shipping cost', 'Amount (EGP)': -retShipCost },
    { 'Item': 'Total buying cost of all orders', 'Amount (EGP)': -buyingCost },
    { 'Item': 'Total extra expenses', 'Amount (EGP)': -totalExp },
    { 'Item': '', 'Amount (EGP)': '' },
    { 'Item': netProfit >= 0 ? '🟢 NET PROFIT' : '🔴 NET LOSS', 'Amount (EGP)': netProfit },
  ];
  const ws1 = XLSX.utils.json_to_sheet(summaryRows);
  ws1['!cols'] = [{ wch: 40 }, { wch: 18 }];

  // Sheet 2: Expenses
  const expRows = cache.expenses.map(e => ({
    'Category': e.category || '',
    'Description': e.description || '',
    'Amount (EGP)': parseFloat(e.amount || 0),
    'Date': e.date || '',
  }));
  const ws2 = XLSX.utils.json_to_sheet(expRows);
  ws2['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 14 }, { wch: 14 }];

  // Sheet 3: Delivered orders breakdown
  const delRows = delivered.map(o => ({
    'Order Code': o.code || '',
    'Customer': o.customer_name || '',
    'Order Total (EGP)': parseFloat(o.total || 0),
    'Est. Shipping': parseFloat(o.est_shipping || 0),
    'Actual Shipping': parseFloat(o.actual_shipping || 0),
    'Date': o.date || '',
  }));
  const ws3 = XLSX.utils.json_to_sheet(delRows);
  ws3['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'P&L Summary');
  XLSX.utils.book_append_sheet(wb, ws2, 'Expenses');
  XLSX.utils.book_append_sheet(wb, ws3, 'Delivered Orders');
  XLSX.writeFile(wb, `Protech_Financials_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast('Financials Excel downloaded ✓');
}

// ═══════════════════════════════════════════════════════════════════
//  ANALYTICS — Customer funnel (product views → checkout → orders)
// ═══════════════════════════════════════════════════════════════════
const ANALYTICS_SB_URL = 'https://wljxplbcfoorqpoflcdz.supabase.co';
const ANALYTICS_SB_KEY = 'sb_publishable_zsHh-eOarHI7BSGtuP6WWQ_PQ4ACoHG';
let analyticsCache = { events: [], loaded: false, loading: false };
let analyticsRange = 7; // days back; null = all time

async function loadAnalytics() {
  analyticsCache.loading = true;
  renderAnalytics();
  try {
    let url = `${ANALYTICS_SB_URL}/rest/v1/analytics_events?select=*&order=created_at.desc&limit=10000`;
    if (analyticsRange !== null) {
      const since = new Date();
      since.setDate(since.getDate() - analyticsRange);
      since.setHours(0, 0, 0, 0);
      url += `&created_at=gte.${since.toISOString()}`;
    }
    const res = await fetch(url, { headers: { apikey: ANALYTICS_SB_KEY, Authorization: 'Bearer ' + (accessToken || ANALYTICS_SB_KEY) } });
    const data = await res.json();
    if (!res.ok || !Array.isArray(data)) {
      analyticsCache.events = [];
      showToast('Analytics: ' + (data?.message || 'table not found — run the SQL migration'));
    } else {
      analyticsCache.events = data;
    }
    analyticsCache.loaded = true;
  } catch (e) {
    analyticsCache.events = [];
    showToast('Analytics load failed: ' + e.message);
  }
  analyticsCache.loading = false;
  renderAnalytics();
}

function setAnalyticsRange(days) {
  analyticsRange = days;
  loadAnalytics();
}

function renderAnalytics() {
  const el = document.getElementById('screen-analytics');
  if (!el) return;

  const ev = analyticsCache.events || [];
  const pv = ev.filter(e => e.event_type === 'product_view');
  const cv = ev.filter(e => e.event_type === 'checkout_view');
  const oc = ev.filter(e => e.event_type === 'order_confirmed');
  const uniq = arr => new Set(arr.map(e => e.session_id)).size;
  const upv = uniq(pv), ucv = uniq(cv), uoc = uniq(oc);

  const checkoutRate = upv ? Math.round(ucv / upv * 100) : 0;
  const convRate = ucv ? Math.round(uoc / ucv * 100) : 0;
  const overall = upv ? Math.round(uoc / upv * 100) : 0;

  // Top products by unique viewers
  const map = {};
  pv.forEach(e => {
    const k = e.product_code || e.product_id; if (!k) return;
    if (!map[k]) map[k] = { code: e.product_code, name: e.product_name, views: 0, sessions: new Set() };
    map[k].views++; map[k].sessions.add(e.session_id);
  });
  const top = Object.values(map).map(p => ({ ...p, u: p.sessions.size })).sort((a, b) => b.u - a.u).slice(0, 15);

  // Daily trend (last 14 days present in data)
  const daily = {};
  ev.forEach(e => {
    const d = (e.created_at || '').slice(0, 10); if (!d) return;
    if (!daily[d]) daily[d] = { pv: 0, cv: 0, oc: 0 };
    if (e.event_type === 'product_view') daily[d].pv++;
    else if (e.event_type === 'checkout_view') daily[d].cv++;
    else if (e.event_type === 'order_confirmed') daily[d].oc++;
  });
  const days = Object.entries(daily).sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
  const maxD = Math.max(1, ...days.map(([, d]) => Math.max(d.pv, d.cv, d.oc)));

  const ranges = [{ l: 'Today', d: 0 }, { l: '7 Days', d: 7 }, { l: '30 Days', d: 30 }, { l: 'All Time', d: null }];
  const rangeBtns = ranges.map(r =>
    `<button class="btn ${analyticsRange === r.d ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="setAnalyticsRange(${r.d})">${r.l}</button>`
  ).join('');

  const funnelBar = (label, val, color) => {
    const pct = upv ? Math.round(val / upv * 100) : 0;
    return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
          <span style="color:var(--muted)">${label}</span><strong style="color:${color}">${val}</strong>
        </div>
        <div style="height:26px;background:#eee;border-radius:6px;overflow:hidden">
          <div style="height:100%;width:${Math.max(pct, val > 0 ? 3 : 0)}%;background:${color};border-radius:6px;display:flex;align-items:center;padding-left:8px;color:#fff;font-size:12px;font-weight:700">${pct > 12 ? pct + '%' : ''}</div>
        </div>
      </div>`;
  };

  const trendChart = days.length ? `
    <div style="display:flex;gap:14px;font-size:12px;margin-bottom:12px">
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#3B82F6;margin-right:4px"></span>Views</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#F59E0B;margin-right:4px"></span>Checkout</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#16a34a;margin-right:4px"></span>Orders</span>
    </div>
    <div style="display:flex;align-items:flex-end;gap:4px;height:150px;overflow-x:auto">
      ${days.map(([day, d]) => `
        <div style="flex:1;min-width:30px;display:flex;flex-direction:column;align-items:center;gap:3px">
          <div style="display:flex;gap:2px;align-items:flex-end;height:120px;width:100%">
            <div title="Views: ${d.pv}" style="flex:1;height:${Math.round(d.pv / maxD * 100)}%;background:#3B82F6;border-radius:3px 3px 0 0;min-height:${d.pv ? 3 : 0}px"></div>
            <div title="Checkout: ${d.cv}" style="flex:1;height:${Math.round(d.cv / maxD * 100)}%;background:#F59E0B;border-radius:3px 3px 0 0;min-height:${d.cv ? 3 : 0}px"></div>
            <div title="Orders: ${d.oc}" style="flex:1;height:${Math.round(d.oc / maxD * 100)}%;background:#16a34a;border-radius:3px 3px 0 0;min-height:${d.oc ? 3 : 0}px"></div>
          </div>
          <span style="font-size:9px;color:var(--muted);white-space:nowrap">${day.slice(5)}</span>
        </div>`).join('')}
    </div>` : '<div class="empty">No daily data in this range</div>';

  const topRows = top.length ? top.map((p, i) => `
    <tr>
      <td style="color:var(--muted)">${i + 1}</td>
      <td><strong>${esc(p.name) || '—'}</strong></td>
      <td><span class="badge b-orange">${esc(p.code) || '—'}</span></td>
      <td style="text-align:center"><span class="badge b-info">${p.u}</span></td>
      <td style="text-align:center;color:var(--muted)">${p.views}</td>
    </tr>`).join('') : '<tr><td colspan="5"><div class="empty"><div class="empty-icon">👁</div>No product views yet</div></td></tr>';

  el.innerHTML = `
    <div style="padding:20px 16px;max-width:1100px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:18px">
        <h2 style="margin:0;font-size:20px">📊 Analytics ${analyticsCache.loading ? '<span style="font-size:13px;color:var(--muted)">loading…</span>' : ''}</h2>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${rangeBtns}
          <button class="btn btn-ghost btn-sm" onclick="loadAnalytics()">↻ Refresh</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:22px">
        <div class="stat-card blue"><div class="stat-val">${upv}</div><div class="stat-label">Product Viewers</div></div>
        <div class="stat-card orange"><div class="stat-val">${ucv}</div><div class="stat-label">Reached Checkout</div></div>
        <div class="stat-card green"><div class="stat-val">${uoc}</div><div class="stat-label">Orders Confirmed</div></div>
        <div class="stat-card ${overall >= 2 ? 'green' : 'red'}"><div class="stat-val">${overall}%</div><div class="stat-label">View → Order</div></div>
      </div>

      <div style="background:#fff;border:1px solid #eee;border-radius:12px;padding:20px;margin-bottom:20px">
        <h3 style="margin:0 0 16px;font-size:15px">Conversion Funnel</h3>
        ${funnelBar('Product Viewers', upv, '#3B82F6')}
        <div style="text-align:center;color:var(--muted);font-size:11px;margin:2px 0">▼ ${checkoutRate}% proceed to checkout</div>
        ${funnelBar('Reached Checkout', ucv, '#F59E0B')}
        <div style="text-align:center;color:var(--muted);font-size:11px;margin:2px 0">▼ ${convRate}% complete the order</div>
        ${funnelBar('Orders Confirmed', uoc, '#16a34a')}
      </div>

      <div style="background:#fff;border:1px solid #eee;border-radius:12px;padding:20px;margin-bottom:20px">
        <h3 style="margin:0 0 16px;font-size:15px">Daily Trend</h3>
        ${trendChart}
      </div>

      <div style="background:#fff;border:1px solid #eee;border-radius:12px;padding:20px">
        <h3 style="margin:0 0 16px;font-size:15px">Most Viewed Products</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Product</th><th>Code</th><th style="text-align:center">Unique Viewers</th><th style="text-align:center">Total Views</th></tr></thead>
            <tbody>${topRows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

// Inject the Analytics screen + nav buttons at runtime (no index.html edit needed)
function injectAnalyticsUI() {
  if (document.getElementById('screen-analytics')) return;
  const home = document.getElementById('screen-home');
  if (!home) return;

  const scr = document.createElement('div');
  scr.id = 'screen-analytics';
  scr.className = home.className.replace('active', '').trim();
  home.parentElement.appendChild(scr);

  const topNav = document.getElementById('top-nav');
  if (topNav) {
    const sample = topNav.querySelector('.nav-tab');
    const tab = sample ? sample.cloneNode(false) : document.createElement('button');
    if (sample) tab.className = sample.className.replace('active', '').trim();
    tab.textContent = '📊 Analytics';
    tab.onclick = () => go('analytics');
    topNav.appendChild(tab);
  }

  const bnavSample = document.querySelector('.bnav-btn');
  if (bnavSample && bnavSample.parentElement) {
    const b = bnavSample.cloneNode(false);
    b.className = bnavSample.className.replace('active', '').trim();
    b.innerHTML = '<span style="font-size:18px">📊</span><span>Stats</span>';
    b.onclick = () => go('analytics');
    bnavSample.parentElement.appendChild(b);
  }
}

(function initAnalytics() {
  const run = () => { injectAnalyticsUI(); loadAnalytics(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
// ═══════════════════════════════════════════════════════════════════
//  SUPPLIER ACCOUNT — Elashry (money owed for goods + payments made)
// ═══════════════════════════════════════════════════════════════════
const SUPPLIER_SB_URL = 'https://wljxplbcfoorqpoflcdz.supabase.co';
const SUPPLIER_SB_KEY = 'sb_publishable_zsHh-eOarHI7BSGtuP6WWQ_PQ4ACoHG';
let supplierCache = { payments: [], charges: [], loaded: false, loading: false };

async function sbSupplierGet(table) {
  try {
    const res = await fetch(`${SUPPLIER_SB_URL}/rest/v1/${table}?select=*&order=created_at.desc`, {
      headers: { apikey: SUPPLIER_SB_KEY, Authorization: 'Bearer ' + (accessToken || SUPPLIER_SB_KEY) }
    });
    const data = await res.json();
    return (res.ok && Array.isArray(data)) ? data : [];
  } catch (e) { return []; }
}

async function loadSupplierPayments() {
  supplierCache.loading = true;
  renderSupplierAccount();
  supplierCache.payments = await sbSupplierGet('supplier_payments');
  supplierCache.loaded = true;
  supplierCache.loading = false;
  renderSupplierAccount();
  if (typeof renderBostaCash === 'function') renderBostaCash(); // cash-on-hand uses Elashry payments
}

// Owed = buy-price cost of goods across ALL orders (no exclusions)
// Goods count as owed to Elashry (and as buying cost) once the order has gone out —
// In Transit or Delivered, and a Returned order keeps counting until its goods are
// received back in inventory (warehouse_confirmed). Processing and Cancelled don't count.
function owesElashry(o) {
  if (o.warehouse_confirmed) return false;
  // Goods are "out" (owed) once picked up and until they're returned to stock.
  return ['In Transit', 'Delivered', 'On its way to me', 'Returned', 'Awaiting Action'].includes(o.status);
}
// Use the buy price snapshotted on the order line at order time; fall back to the
// product's current buy price for older orders that have no snapshot.
function lineBuyPrice(p, products) {
  if (p && p.buy_price != null && p.buy_price !== '') return parseFloat(p.buy_price) || 0;
  const pr = products.find(pp => pp.code === p.code);
  return parseFloat(pr?.buy_price || 0);
}

function computeSupplierOwed() {
  const orders = (typeof cache !== 'undefined' && cache.orders) ? cache.orders : [];
  const products = (typeof cache !== 'undefined' && cache.products) ? cache.products : [];
  let owed = 0;
  orders.forEach(o => {
    if (!owesElashry(o)) return;
    (o.products || []).forEach(p => {
      owed += lineBuyPrice(p, products) * parseInt(p.qty || 1);
    });
  });
  return owed;
}

// Itemized breakdown of exactly which order lines make up the Elashry "goods owed",
// so over-valued / wrongly-counted orders are easy to spot.
function downloadSupplierBreakdownExcel() {
  const products = cache.products;
  const rows = [];
  cache.orders.filter(owesElashry).forEach(o => {
    (o.products || []).forEach(p => {
      const bp = lineBuyPrice(p, products);
      const qty = parseInt(p.qty || 1);
      rows.push({
        'Order Code': o.code || '',
        'Status': o.status || '',
        'Date': o.date || '',
        'Customer': o.customer_name || '',
        'Product Code': p.code || '',
        'Product': p.name || (products.find(x => x.code === p.code)?.name) || p.code || '',
        'Qty': qty,
        'Buy Price': bp,
        'Line Total': Math.round(bp * qty * 100) / 100,
      });
    });
  });
  if (!rows.length) { showToast('No orders are counted toward Elashry'); return; }
  const total = rows.reduce((a, r) => a + r['Line Total'], 0);
  rows.push({});
  rows.push({ 'Product': 'TOTAL OWED (goods)', 'Line Total': Math.round(total * 100) / 100 });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 14 }, { wch: 34 }, { wch: 6 }, { wch: 12 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Elashry Owed');
  XLSX.writeFile(wb, `Elashry_Owed_Breakdown_${new Date().toISOString().slice(0, 10)}.xlsx`);
  showToast('Breakdown downloaded ✓');
}

function renderSupplierAccount() {
  const host = document.getElementById('supplier-account');
  if (!host) return;

  const goodsOwed = computeSupplierOwed();
  // Extra purchases from Elashry = expenses logged with the "Elashry" category.
  const elashryExpenses = (cache.expenses || []).filter(e => e.category === 'Elashry');
  const chargesTotal = elashryExpenses.reduce((a, c) => a + parseFloat(c.amount || 0), 0);
  const owed = goodsOwed + chargesTotal;
  const paid = supplierCache.payments.reduce((a, p) => a + parseFloat(p.amount || 0), 0);
  const remaining = owed - paid;
  const settled = remaining <= 0;

  const chargeRows = elashryExpenses.length
    ? elashryExpenses.map(c => `
        <tr>
          <td>${esc(c.date) || '—'}</td>
          <td><strong>EGP ${fmt(c.amount)}</strong></td>
          <td>${esc(c.description) || '—'}</td>
          <td><button class="btn btn-danger btn-xs" onclick="delExpense('${c.id}')">✕</button></td>
        </tr>`).join('')
    : '<tr><td colspan="4"><div class="empty">No Elashry purchases yet — add an expense with category "Elashry"</div></td></tr>';

  const payRows = supplierCache.payments.length
    ? supplierCache.payments.map(p => `
        <tr>
          <td>${esc(p.date) || '—'}</td>
          <td><strong>EGP ${fmt(p.amount)}</strong></td>
          <td>${esc(p.note) || '—'}</td>
          <td><button class="btn btn-danger btn-xs" onclick="delSupplierPayment('${p.id}')">✕</button></td>
        </tr>`).join('')
    : '<tr><td colspan="4"><div class="empty">No payments to Elashry recorded yet</div></td></tr>';

  host.innerHTML = `
    <div style="margin-top:28px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        <h3 style="margin:0;font-size:16px;display:flex;align-items:center;gap:8px">
          🏭 Supplier Account — Elashry
          ${supplierCache.loading ? '<span style="font-size:12px;color:var(--muted)">loading…</span>' : ''}
        </h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="downloadSupplierBreakdownExcel()">📥 Breakdown</button>
          <button class="btn btn-ghost btn-sm" onclick="openExpense('Elashry')">+ Record Purchase</button>
          <button class="btn btn-primary btn-sm" onclick="openSupplierPayment()">+ Record Payment</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:8px">
        <div class="stat-card orange"><div class="stat-val">EGP ${fmt(owed)}</div><div class="stat-label">Total Owed (goods + purchases)</div></div>
        <div class="stat-card blue"><div class="stat-val">EGP ${fmt(paid)}</div><div class="stat-label">Total Paid to Elashry</div></div>
        <div class="stat-card ${settled ? 'green' : 'red'}"><div class="stat-val">EGP ${fmt(Math.abs(remaining))}</div><div class="stat-label">${settled ? (remaining < 0 ? 'Overpaid / Credit' : 'Fully Settled') : 'Remaining to Pay'}</div></div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:18px">
        Goods from orders: EGP ${fmt(goodsOwed)} &nbsp;+&nbsp; Extra purchases: EGP ${fmt(chargesTotal)}
      </div>

      <h4 style="margin:6px 0;font-size:13px;color:var(--muted)">Extra purchases from Elashry (added to what you owe)</h4>
      <div class="table-wrap" style="margin-bottom:16px">
        <table>
          <thead><tr><th>Date</th><th>Amount</th><th>Note</th><th></th></tr></thead>
          <tbody>${chargeRows}</tbody>
        </table>
      </div>

      <h4 style="margin:6px 0;font-size:13px;color:var(--muted)">Payments to Elashry</h4>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Amount</th><th>Note</th><th></th></tr></thead>
          <tbody>${payRows}</tbody>
        </table>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:8px">
        Goods owed = buy-price × qty for In-Transit, Delivered and Returned orders (until received back in inventory), valued at the buy price when the order was placed. "Extra purchases" are added on top.
      </div>
    </div>`;
}

function openSupplierPayment() {
  const overlay = document.getElementById('overlay');
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:440px;width:92%;padding:24px;max-height:90vh;overflow:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <h3 style="margin:0;font-size:17px">🏭 Record Payment to Elashry</h3>
        <button class="btn btn-ghost btn-xs" onclick="closeModal()">✕</button>
      </div>
      <div class="form-group">
        <label>Amount Paid (EGP) *</label>
        <input type="number" id="sp-amt" min="0" placeholder="0" inputmode="decimal">
      </div>
      <div class="form-group">
        <label>Date</label>
        <input type="text" id="sp-date" value="${today()}">
      </div>
      <div class="form-group">
        <label>Note (optional)</label>
        <input type="text" id="sp-note" placeholder="e.g. cash for June batch">
      </div>
      <div style="display:flex;gap:10px;margin-top:8px">
        <button class="btn btn-primary" style="flex:1" onclick="saveSupplierPayment()">Save Payment</button>
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      </div>
    </div>`;
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('sp-amt')?.focus(), 60);
}

async function saveSupplierPayment() {
  const amount = parseFloat(document.getElementById('sp-amt').value || 0);
  const note = document.getElementById('sp-note').value.trim();
  const date = document.getElementById('sp-date').value.trim() || today();
  if (!amount || amount <= 0) { showToast('Please enter a valid amount'); return; }
  const data = { id: genId(), amount, note, date, created_at: new Date().toISOString() };
  try {
    const res = await fetch(`${SUPPLIER_SB_URL}/rest/v1/supplier_payments`, {
      method: 'POST',
      headers: { apikey: SUPPLIER_SB_KEY, Authorization: 'Bearer ' + (accessToken || SUPPLIER_SB_KEY), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(await res.text());
    supplierCache.payments.unshift(data);
    showToast('Payment to Elashry recorded ✓');
    closeModal();
    renderSupplierAccount();
  } catch (e) { showToast('Error: ' + e.message); }
}

async function delSupplierPayment(id) {
  if (!confirm('Delete this payment record?')) return;
  try {
    const res = await fetch(`${SUPPLIER_SB_URL}/rest/v1/supplier_payments?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { apikey: SUPPLIER_SB_KEY, Authorization: 'Bearer ' + (accessToken || SUPPLIER_SB_KEY), Prefer: 'return=minimal' }
    });
    if (!res.ok) throw new Error(await res.text());
    supplierCache.payments = supplierCache.payments.filter(p => p.id !== id);
    showToast('Payment deleted');
    renderSupplierAccount();
  } catch (e) { showToast('Error: ' + e.message); }
}


// Inject the supplier section into the Financials screen + auto-render with it
function injectSupplierUI() {
  if (document.getElementById('supplier-account')) return;
  const fin = document.getElementById('screen-financials');
  if (!fin) return;
  const div = document.createElement('div');
  div.id = 'supplier-account';
  const netCard = document.getElementById('fin-net-card');
  if (netCard) fin.insertBefore(div, netCard); else fin.appendChild(div);
}

(function initSupplier() {
  const run = () => {
    injectSupplierUI();
    if (typeof renderFinancials === 'function' && !renderFinancials.__supplierPatched) {
      const orig = renderFinancials;
      renderFinancials = function () { orig.apply(this, arguments); renderSupplierAccount(); };
      renderFinancials.__supplierPatched = true;
    }
    loadSupplierPayments();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

// ═══════════════════════════════════════════════════════════════════
//  SAFE / BANK — money received from Bosta (logged manually)
// ═══════════════════════════════════════════════════════════════════
let bostaCashCache = { receipts: [], loading: false };

async function loadBostaReceipts() {
  bostaCashCache.loading = true;
  renderBostaCash();
  bostaCashCache.receipts = await sbSupplierGet('bosta_receipts');
  bostaCashCache.loading = false;
  renderBostaCash();
}

function renderBostaCash() {
  const host = document.getElementById('bosta-cash');
  if (!host) return;
  const total = (bostaCashCache.receipts || []).reduce((a, r) => a + parseFloat(r.amount || 0), 0);
  // Money Bosta owes us = net COD of Delivered orders (total − Bosta's shipping fee),
  // minus any Bosta fees deducted from the payout (e.g. small-pickup fee).
  const delivered = (typeof cache !== 'undefined' && cache.orders ? cache.orders : []).filter(o => o.status === 'Delivered');
  const deliveredNet = delivered.reduce((a, o) => a + (parseFloat(o.total || 0) - parseFloat(o.actual_shipping || 0)), 0);
  const bostaFees = (cache.expenses || []).filter(e => e.category === 'Bosta Fees').reduce((a, e) => a + parseFloat(e.amount || 0), 0);
  const expected = deliveredNet - bostaFees;
  const remaining = expected - total;
  // Projection: net COD of In-Transit orders (what Bosta would owe once they deliver).
  const inTransit = (typeof cache !== 'undefined' && cache.orders ? cache.orders : []).filter(o => o.status === 'In Transit');
  const inTransitNet = inTransit.reduce((a, o) => a + (parseFloat(o.total || 0) - parseFloat(o.actual_shipping || 0)), 0);

  // ── CASH ON HAND ──
  // = starting capital + money received from Bosta − payments to Elashry
  //   − operating expenses actually paid (excluding Elashry purchases [credit] and
  //   Bosta fees [already netted from the received amount]).
  const startingCapital = parseFloat(localStorage.getItem('protech_starting_capital') || 0) || 0;
  const elashryPaid = (typeof supplierCache !== 'undefined' && supplierCache.payments ? supplierCache.payments : [])
    .reduce((a, p) => a + parseFloat(p.amount || 0), 0);
  const opExpenses = (cache.expenses || [])
    .filter(e => e.category !== 'Elashry' && e.category !== 'Bosta Fees')
    .reduce((a, e) => a + parseFloat(e.amount || 0), 0);
  const cashOnHand = startingCapital + total - elashryPaid - opExpenses;
  const rows = (bostaCashCache.receipts || []).length
    ? bostaCashCache.receipts.map(r => `
        <tr>
          <td>${esc(r.date) || '—'}</td>
          <td><strong>EGP ${fmt(r.amount)}</strong></td>
          <td>${esc(r.note) || '—'}</td>
          <td><button class="btn btn-danger btn-xs" onclick="delBostaReceipt('${r.id}')">✕</button></td>
        </tr>`).join('')
    : '<tr><td colspan="4"><div class="empty">No money received logged yet</div></td></tr>';
  host.innerHTML = `
    <div style="margin-top:28px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        <h3 style="margin:0;font-size:16px;display:flex;align-items:center;gap:8px">💰 Safe / Bank — Money received from Bosta
          ${bostaCashCache.loading ? '<span style="font-size:12px;color:var(--muted)">loading…</span>' : ''}
        </h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="openExpense('Bosta Fees')">+ Record Bosta fee</button>
          <button class="btn btn-primary btn-sm" onclick="openBostaReceipt()">+ Record Receipt</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:8px">
        <div class="stat-card green"><div class="stat-val">EGP ${fmt(total)}</div><div class="stat-label">In Safe / Bank (received from Bosta)</div></div>
        <div class="stat-card blue"><div class="stat-val">EGP ${fmt(expected)}</div><div class="stat-label">Expected from Bosta (after fees)</div></div>
        <div class="stat-card ${remaining > 0 ? 'orange' : 'green'}"><div class="stat-val">EGP ${fmt(Math.abs(remaining))}</div><div class="stat-label">${remaining > 0 ? 'Still to collect from Bosta' : 'All collected ✓'}</div></div>
        <div class="stat-card blue"><div class="stat-val">EGP ${fmt(inTransitNet)}</div><div class="stat-label">Coming if In-Transit delivered</div></div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:18px">
        Delivered net COD: EGP ${fmt(deliveredNet)} &nbsp;−&nbsp; Bosta fees deducted: EGP ${fmt(bostaFees)} &nbsp;=&nbsp; Expected EGP ${fmt(expected)}
      </div>

      <div style="background:${cashOnHand >= 0 ? '#f0fdf4' : '#fef2f2'};border:2px solid ${cashOnHand >= 0 ? '#16a34a' : '#dc2626'};border-radius:12px;padding:16px;margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
          <div>
            <div style="font-size:13px;color:var(--muted);font-weight:700">💵 Cash on hand (الكاش المتاح فعلياً)</div>
            <div style="font-size:28px;font-weight:900;color:${cashOnHand >= 0 ? '#16a34a' : '#dc2626'}">EGP ${fmt(cashOnHand)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <label style="font-size:12px;color:var(--muted);font-weight:700">Starting capital</label>
            <input type="number" id="cash-start-cap" value="${startingCapital || ''}" placeholder="0" inputmode="decimal"
              onchange="saveStartingCapital(this.value)"
              style="width:120px;padding:8px 10px;border:1px solid #ccc;border-radius:8px;font-size:14px">
          </div>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-top:10px;line-height:1.8">
          ${fmt(startingCapital)} رأس مال
          &nbsp;+&nbsp; ${fmt(total)} مستلم من بوسطة
          &nbsp;−&nbsp; ${fmt(elashryPaid)} مدفوع للأشري
          &nbsp;−&nbsp; ${fmt(opExpenses)} مصاريف تشغيل
          <br><span style="opacity:.8">لا يشمل: المستحق من بوسطة (لم يصل بعد) ولا الدين غير المدفوع للأشري.</span>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Amount</th><th>Note</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// Starting capital is a manual figure (cash the owner put in that isn't already
// recorded as an expense). Stored locally in the browser.
function saveStartingCapital(v) {
  const n = parseFloat(v || 0) || 0;
  localStorage.setItem('protech_starting_capital', String(n));
  renderBostaCash();
  showToast('Starting capital saved ✓');
}

function openBostaReceipt() {
  const overlay = document.getElementById('overlay');
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:440px;width:92%;padding:24px;max-height:90vh;overflow:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <h3 style="margin:0;font-size:17px">💰 Record Money Received from Bosta</h3>
        <button class="btn btn-ghost btn-xs" onclick="closeModal()">✕</button>
      </div>
      <div class="form-group"><label>Amount Received (EGP) *</label><input type="number" id="br-amt" min="0" placeholder="0" inputmode="decimal"></div>
      <div class="form-group"><label>Date</label><input type="text" id="br-date" value="${today()}"></div>
      <div class="form-group"><label>Note (optional)</label><input type="text" id="br-note" placeholder="e.g. bank transfer"></div>
      <div style="display:flex;gap:10px;margin-top:8px">
        <button class="btn btn-primary" style="flex:1" onclick="saveBostaReceipt()">Save</button>
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      </div>
    </div>`;
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('br-amt')?.focus(), 60);
}

async function saveBostaReceipt() {
  const amount = parseFloat(document.getElementById('br-amt').value || 0);
  const note = document.getElementById('br-note').value.trim();
  const date = document.getElementById('br-date').value.trim() || today();
  if (!amount || amount <= 0) { showToast('Please enter a valid amount'); return; }
  const data = { id: genId(), amount, note, date, created_at: new Date().toISOString() };
  try {
    const res = await fetch(`${SUPPLIER_SB_URL}/rest/v1/bosta_receipts`, {
      method: 'POST',
      headers: { apikey: SUPPLIER_SB_KEY, Authorization: 'Bearer ' + (accessToken || SUPPLIER_SB_KEY), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(await res.text());
    bostaCashCache.receipts.unshift(data);
    showToast('Receipt recorded ✓');
    closeModal();
    renderBostaCash();
  } catch (e) { showToast('Error: ' + e.message); }
}

async function delBostaReceipt(id) {
  if (!confirm('Delete this receipt?')) return;
  try {
    const res = await fetch(`${SUPPLIER_SB_URL}/rest/v1/bosta_receipts?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { apikey: SUPPLIER_SB_KEY, Authorization: 'Bearer ' + (accessToken || SUPPLIER_SB_KEY), Prefer: 'return=minimal' }
    });
    if (!res.ok) throw new Error(await res.text());
    bostaCashCache.receipts = bostaCashCache.receipts.filter(r => r.id !== id);
    showToast('Receipt deleted');
    renderBostaCash();
  } catch (e) { showToast('Error: ' + e.message); }
}

// ═══════════════════════════════════════════════════════════════════
//  ABANDONED CARTS — people who reached checkout but didn't finish
// ═══════════════════════════════════════════════════════════════════
let cartsCache = { rows: [], loaded: false, loading: false, error: null };

async function loadAbandonedCarts() {
  cartsCache.loading = true;
  cartsCache.error = null;
  renderAbandonedCarts();
  try {
    const res = await fetch(`${SUPPLIER_SB_URL}/rest/v1/abandoned_carts?status=eq.open&order=updated_at.desc`, {
      headers: { apikey: SUPPLIER_SB_KEY, Authorization: 'Bearer ' + (accessToken || SUPPLIER_SB_KEY) }
    });
    if (!res.ok) {
      const txt = await res.text();
      cartsCache.rows = [];
      cartsCache.error = /does not exist|relation|42P01|PGRST205/i.test(txt)
        ? 'الجدول غير موجود — شغّل ملف create_abandoned_carts.sql في Supabase'
        : ('تعذّر تحميل السلات: ' + txt.slice(0, 140));
    } else {
      const data = await res.json();
      cartsCache.rows = Array.isArray(data) ? data : [];
    }
  } catch (e) { cartsCache.rows = []; cartsCache.error = e.message; }
  cartsCache.loaded = true;
  cartsCache.loading = false;
  renderAbandonedCarts();
}

function timeAgo(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (isNaN(diff)) return '—';
  if (diff < 3600) return `منذ ${Math.max(1, Math.round(diff / 60))} دقيقة`;
  if (diff < 86400) return `منذ ${Math.round(diff / 3600)} ساعة`;
  return `منذ ${Math.round(diff / 86400)} يوم`;
}

function cartWaLink(c) {
  const items = (Array.isArray(c.items) ? c.items : []).map(i => `• ${i.name || i.code} × ${i.qty || 1}`).join('\n');
  const msg = encodeURIComponent(
`مرحباً ${c.name || ''}
لاحظنا إنك بدأت طلب من *بروتيك* ولم تكمله 🛒

المنتجات في سلتك:
${items}

تحب نساعدك تكمل طلبك؟ إحنا متاحين لأي استفسار 🙏
الدفع عند الاستلام والشحن لكل المحافظات.`);
  const waPhone = String(c.phone || '').startsWith('0') ? '2' + c.phone : c.phone;
  return `https://wa.me/${waPhone}?text=${msg}`;
}

function renderAbandonedCarts() {
  const stats = document.getElementById('carts-stats');
  const body = document.getElementById('carts-body');
  if (!body) return;
  const rows = cartsCache.rows || [];
  const potential = rows.reduce((a, c) => a + parseFloat(c.total || 0), 0);
  if (stats) stats.innerHTML = `
    <div class="stat-card orange"><div class="stat-val">${rows.length}</div><div class="stat-label">Open Carts</div></div>
    <div class="stat-card green"><div class="stat-val">EGP ${fmt(potential)}</div><div class="stat-label">Potential Value</div></div>`;
  if (cartsCache.error) {
    body.innerHTML = `<div style="background:#fef2f2;border:1px solid #fecaca;color:#dc2626;border-radius:10px;padding:16px;font-weight:700">⚠️ ${esc(cartsCache.error)}</div>`;
    return;
  }
  body.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Customer</th><th>Phone</th><th>Items</th><th>Total</th><th>When</th><th>Action</th></tr></thead>
        <tbody>${rows.length ? rows.map(c => {
          const items = (Array.isArray(c.items) ? c.items : []).map(i => `${esc(i.name || i.code)} × ${i.qty || 1}`).join('<br>');
          return `<tr>
            <td><strong>${esc(c.name) || '—'}</strong></td>
            <td>${esc(c.phone)}</td>
            <td style="font-size:12px;line-height:1.7">${items || '—'}</td>
            <td>EGP ${fmt(c.total || 0)}</td>
            <td style="font-size:12px;color:var(--muted)">${esc(timeAgo(c.updated_at || c.created_at))}</td>
            <td><div class="actions" style="gap:6px">
              <a href="${cartWaLink(c)}" target="_blank" class="btn btn-xs" style="background:#25D366;color:#fff">📲 ذكّره</a>
              <button class="btn btn-ghost btn-xs" onclick="dismissCart('${esc(c.id)}')">Dismiss</button>
            </div></td>
          </tr>`;
        }).join('') : `<tr><td colspan="6"><div class="empty"><div class="empty-icon">🛒</div>${cartsCache.loading ? 'loading…' : 'No abandoned carts 🎉'}</div></td></tr>`}</tbody>
      </table>
    </div>`;
}

async function dismissCart(id) {
  try {
    const res = await fetch(`${SUPPLIER_SB_URL}/rest/v1/abandoned_carts?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { apikey: SUPPLIER_SB_KEY, Authorization: 'Bearer ' + (accessToken || SUPPLIER_SB_KEY), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'dismissed' })
    });
    if (!res.ok) throw new Error(await res.text());
    cartsCache.rows = cartsCache.rows.filter(c => c.id !== id);
    showToast('Cart dismissed');
    renderAbandonedCarts();
  } catch (e) { showToast('Error: ' + e.message); }
}

function injectBostaCashUI() {
  if (document.getElementById('bosta-cash')) return;
  const fin = document.getElementById('screen-financials');
  if (!fin) return;
  const div = document.createElement('div');
  div.id = 'bosta-cash';
  const netCard = document.getElementById('fin-net-card');
  if (netCard) fin.insertBefore(div, netCard); else fin.appendChild(div);
}

(function initBostaCash() {
  const run = () => {
    injectBostaCashUI();
    if (typeof renderFinancials === 'function' && !renderFinancials.__bostaCashPatched) {
      const orig = renderFinancials;
      renderFinancials = function () { orig.apply(this, arguments); renderBostaCash(); };
      renderFinancials.__bostaCashPatched = true;
    }
    loadBostaReceipts();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
// ═══════════════════════════════════════════════════════════════════
//  ORDER PROGRESS TRACKER — 3 ticks per order
//  1) Confirmation sent (WhatsApp)  2) Delivered  3) Feedback sent (WhatsApp)
// ═══════════════════════════════════════════════════════════════════
const TRACK_SB_URL = 'https://wljxplbcfoorqpoflcdz.supabase.co';
const TRACK_SB_KEY = 'sb_publishable_zsHh-eOarHI7BSGtuP6WWQ_PQ4ACoHG';

// Mark a tracking flag true/false in DB + cache, then refresh views
async function setOrderFlag(orderId, field, value) {
  try {
    const res = await fetch(`${TRACK_SB_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: { apikey: TRACK_SB_KEY, Authorization: 'Bearer ' + (accessToken || TRACK_SB_KEY), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ [field]: value })
    });
    if (!res.ok) throw new Error(await res.text());
    const i = cache.orders.findIndex(x => x.id === orderId);
    if (i >= 0) cache.orders[i][field] = value;
  } catch (e) { showToast('Error: ' + e.message); }
}

// Called by the WhatsApp confirmation button — auto-marks confirm_sent
async function markConfirmSent(orderId) {
  await setOrderFlag(orderId, 'confirm_sent', true);
  showToast('Confirmation marked as sent ✓');
  renderOrderTracker(orderId);
}

// Called by the WhatsApp feedback button — auto-marks feedback_sent
async function markFeedbackSent(orderId) {
  await setOrderFlag(orderId, 'feedback_sent', true);
  showToast('Feedback marked as sent ✓');
  renderOrderTracker(orderId);
}

// Build the 3-tick HTML for one order
function orderTrackerHTML(o) {
  const delivered = o.status === 'Delivered';
  const steps = [
    { on: !!o.confirm_sent, label: 'Confirmation Sent', icon: '📲' },
    { on: delivered,        label: 'Delivered',         icon: '🚚' },
    { on: !!o.feedback_sent, label: 'Feedback Sent',     icon: '⭐' },
  ];
  return `
    <div style="display:flex;align-items:center;gap:0;flex-wrap:wrap;margin:4px 0">
      ${steps.map((s, i) => `
        <div style="display:flex;align-items:center;gap:6px">
          <div title="${s.label}" style="display:flex;flex-direction:column;align-items:center;gap:3px;min-width:70px">
            <div style="width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-size:14px;font-weight:800;
              background:${s.on ? '#16a34a' : '#e5e7eb'};color:${s.on ? '#fff' : '#9ca3af'};
              border:2px solid ${s.on ? '#16a34a' : '#e5e7eb'};transition:all .2s">
              ${s.on ? '✓' : s.icon}
            </div>
            <span style="font-size:10px;font-weight:600;color:${s.on ? '#16a34a' : '#9ca3af'};text-align:center;white-space:nowrap">${s.label}</span>
          </div>
          ${i < steps.length - 1 ? `<div style="width:24px;height:3px;background:${steps[i + 1].on ? '#16a34a' : '#e5e7eb'};margin:0 2px;margin-bottom:18px;border-radius:2px"></div>` : ''}
        </div>`).join('')}
    </div>`;
}

// Re-render just the tracker inside the open order detail (if present)
function renderOrderTracker(orderId) {
  const host = document.getElementById('order-tracker-' + orderId);
  const o = cache.orders.find(x => x.id === orderId);
  if (host && o) host.innerHTML = orderTrackerHTML(o);
}
// Small inline progress indicator for the orders table row
function orderProgressBadge(o) {
  const c = !!o.confirm_sent;
  const d = o.status === 'Delivered';
  const f = !!o.feedback_sent;
  const done = [c, d, f].filter(Boolean).length;

  if (done === 3) {
    return `<span title="All steps complete: confirmed, delivered, feedback sent"
      style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#16a34a;color:#fff;font-size:12px;font-weight:800;vertical-align:middle;margin-right:4px">✓</span>`;
  }

  // Partial: 3 mini dots showing which steps are done
  const dot = (on, label) =>
    `<span title="${label}" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${on ? '#16a34a' : '#d1d5db'};margin:0 1px"></span>`;
  return `<span style="display:inline-flex;align-items:center;gap:1px;vertical-align:middle;margin-right:4px">
    ${dot(c, 'Confirmation sent')}${dot(d, 'Delivered')}${dot(f, 'Feedback sent')}
  </span>`;
}
