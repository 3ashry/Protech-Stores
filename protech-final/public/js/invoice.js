const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function printInvoice(id) {
  const o = cache.orders.find(x => x.id === id);
  if (!o) return;

  const logoSrc = document.querySelector('.topbar-logo img')?.src || '';

  // ── Read line items correctly ─────────────────────────────────────────────
  // Customer orders save items as { id, code, name, qty, price }
  // Manual admin orders save items as { code, qty, sell_price }
  // Fall back through both, then to the product cache as a last resort.
  const items = (o.products || []).map(p => {
    const pr = cache.products.find(pp => pp.code === p.code);
    const unit = parseFloat(
      p.sell_price != null && p.sell_price !== '' ? p.sell_price :
      p.price      != null && p.price      !== '' ? p.price      :
      pr?.price ?? 0
    );
    const qty = parseInt(p.qty || 1);
    return {
      code: p.code || '',
      name: p.name || pr?.name || p.code || '—',
      qty,
      unit,
      line: unit * qty,
    };
  });

  // ── Compute totals ────────────────────────────────────────────────────────
  // Shipping: prefer the admin-entered actual_shipping, fall back to estimate.
  const shipCost = parseFloat(o.actual_shipping || 0) || parseFloat(o.est_shipping || 0) || 0;

  // Subtotal = products only, no shipping.
  const subtotal = items.reduce((s, it) => s + it.line, 0);

  // Grand total = subtotal + shipping (shipping added ONCE).
  // We do NOT use o.total here because the store already baked shipping into it,
  // and recomputing from line items keeps the invoice consistent with what's displayed.
  const grandTotal = subtotal + shipCost;

  // ── Render product rows (NO fake  line) ───────────────────────────
  const productsRows = items.map((it, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#fafafa'}">
      <td style="padding:9px 12px;border-bottom:1px solid #f0ebe7;font-size:13px">${esc(it.code)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f0ebe7;font-size:13px">${esc(it.name)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f0ebe7;font-size:13px;text-align:center">${it.qty}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f0ebe7;font-size:13px;text-align:center">${Math.round(it.unit)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f0ebe7;font-size:13px;text-align:center;font-weight:700;color:#F26522">${Math.round(it.line)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width">
<title>فاتوره - ${esc(o.code)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Cairo', sans-serif;
    background: #fff;
    color: #2D2926;
    direction: rtl;
  }
  .page {
    width: 148mm;
    margin: 0 auto;
    background: #fff;
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 210mm;
  }
  .top-border { height: 4px; background: #F26522; }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px 10px;
    border-bottom: 1px solid #f0ebe7;
  }
  .logo { height: 48px; width: auto; object-fit: contain; }
  .invoice-title {
    font-size: 28px;
    font-weight: 900;
    color: #F26522;
    letter-spacing: 1px;
  }
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    padding: 14px 16px;
    border-bottom: 2px solid #F26522;
  }
  .info-group { margin-bottom: 10px; }
  .info-label {
    font-size: 10px;
    color: #aaa;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .5px;
    margin-bottom: 2px;
  }
  .info-value {
    font-size: 12px;
    font-weight: 700;
    color: #2D2926;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 0;
  }
  thead tr {
    background: #f5f5f5;
  }
  th {
    padding: 9px 12px;
    font-size: 11px;
    font-weight: 800;
    color: #2D2926;
    text-align: right;
    border-bottom: 2px solid #F26522;
  }
  th:nth-child(3), th:nth-child(4), th:nth-child(5) { text-align: center; }
  .totals-section {
    padding: 0;
    border-top: 1px solid #f0ebe7;
  }
  .totals-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 16px;
    font-size: 12px;
    color: #6b6b6b;
  }
  .totals-row .label { font-weight: 600; }
  .totals-row .value { font-weight: 700; color: #2D2926; }
  .total-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-top: 2px solid #F26522;
    background: #fff8f5;
  }
  .total-label {
    font-size: 14px;
    font-weight: 800;
    color: #2D2926;
  }
  .total-amount {
    font-size: 20px;
    font-weight: 900;
    color: #F26522;
  }
  .footer {
    background: #2D2926;
    padding: 14px 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: auto;
  }
  .footer-slogan {
    font-size: 13px;
    font-weight: 800;
    color: #F26522;
    line-height: 1.6;
  }
  .footer-contact {
    text-align: left;
    font-size: 10px;
    color: #fff;
    line-height: 1.8;
  }
  .footer-contact .phone {
    color: #F26522;
    font-size: 12px;
    font-weight: 700;
  }
  .bottom-border { height: 4px; background: #F26522; }
  @media print {
    body { margin: 0; }
    .page { margin: 0; width: 100%; min-height: auto; }
    .footer { break-inside: avoid; }
    .no-print { display: none; }
  }
</style>
</head>
<body>

<div class="no-print" style="text-align:center;padding:16px;background:#f5f5f5;font-family:Cairo,sans-serif">
  <button onclick="window.print()" style="background:#F26522;color:#fff;border:none;padding:12px 32px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:Cairo,sans-serif">
    طباعة / حفظ PDF
  </button>
</div>

<div class="page">
  <div class="top-border"></div>

  <div class="header">
    <img src="${logoSrc}" class="logo" alt="Protech">
    <div class="invoice-title">فاتوره</div>
  </div>

  <div class="info-grid">
    <div>
      <div class="info-group">
        <div class="info-label">العميل</div>
        <div class="info-value">${esc(o.customer_name) || '—'}</div>
      </div>
      <div class="info-group">
        <div class="info-label">عنوان الشحن</div>
        <div class="info-value">${esc(o.address) || '—'}</div>
      </div>
      <div class="info-group">
        <div class="info-label">تليفون العميل</div>
        <div class="info-value">${esc(o.phone) || '—'}</div>
      </div>
    </div>
    <div style="text-align:left">
      <div class="info-group">
        <div class="info-label">رقم الفاتوره</div>
        <div class="info-value">${esc(o.code) || '—'}</div>
      </div>
      <div class="info-group">
        <div class="info-label">تاريخ الاصدار</div>
        <div class="info-value">${esc(o.date) || '—'}</div>
      </div>
      <div class="info-group">
        <div class="info-label">كود الشحن</div>
        <div class="info-value">${esc(o.ship_code) || '—'}</div>
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>كود المنتج</th>
        <th>وصف المنتج</th>
        <th style="text-align:center">الكميه</th>
        <th style="text-align:center">سعر الوحده</th>
        <th style="text-align:center">الاجمالي</th>
      </tr>
    </thead>
    <tbody>
      ${productsRows}
    </tbody>
  </table>

  <div class="totals-section">
    <div class="totals-row">
      <span class="label">المجموع الفرعي</span>
      <span class="value">جم ${Math.round(subtotal)}</span>
    </div>
    <div class="totals-row">
      <span class="label">رسوم الشحن</span>
      <span class="value">${shipCost > 0 ? 'جم ' + Math.round(shipCost) : 'مجاني'}</span>
    </div>
  </div>

  <div class="total-row">
    <div class="total-label">الاجمالي</div>
    <div class="total-amount">جم ${Math.round(grandTotal)}</div>
  </div>

  <div class="footer">
    <div class="footer-slogan">الشغل عليك<br>و العده علينا</div>
    <div class="footer-contact">
      للتواصل كلمنا علي :<br>
      <span class="phone">01034482071</span><br>
      Support@protechstores.com
    </div>
  </div>

  <div class="bottom-border"></div>
</div>

</body>
</html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}
