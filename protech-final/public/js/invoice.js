function printInvoice(id) {
  const o = cache.orders.find(x => x.id === id);
  if (!o) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });

  const orange = [242, 101, 34];
  const dark = [45, 41, 38];
  const lightGray = [245, 245, 245];
  const white = [255, 255, 255];

  doc.setFillColor(...white);
  doc.rect(0, 0, 148, 210, 'F');

  // Orange top border
  doc.setFillColor(...orange);
  doc.rect(0, 0, 148, 2, 'F');

  // Logo
  try {
    const logoEl = document.querySelector('.topbar-logo img');
    if (logoEl) {
      const src = logoEl.src;
      doc.addImage(src, 'PNG', 5, 4, 40, 22);
    }
  } catch(e) {}

  // Invoice title Arabic
  doc.setTextColor(...orange);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('فاتوره', 143, 18, { align: 'right' });

  // Divider
  doc.setDrawColor(...orange);
  doc.setLineWidth(0.4);
  doc.line(5, 29, 143, 29);

  // Info grid
  const lc = [160, 160, 160];

  // Left: customer info
  doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(...lc);
  doc.text('العميل', 5, 35);
  doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...dark);
  doc.text(o.customer_name || '', 5, 41);

  doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(...lc);
  doc.text('عنوان الشحن', 5, 48);
  doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...dark);
  doc.text('القاهره عين شمس', 5, 54);

  doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(...lc);
  doc.text('تليفون العميل', 5, 61);
  doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...dark);
  doc.text(o.phone || '', 5, 67);

  // Right: invoice info
  doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(...lc);
  doc.text('رقم الفاتوره', 143, 35, { align: 'right' });
  doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...dark);
  doc.text(o.code || '', 143, 41, { align: 'right' });

  doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(...lc);
  doc.text('تاريخ الاصدار', 143, 48, { align: 'right' });
  doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...dark);
  doc.text(o.date || '', 143, 54, { align: 'right' });

  doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(...lc);
  doc.text('كود الشحن', 143, 61, { align: 'right' });
  doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...dark);
  doc.text(o.ship_code || '—', 143, 67, { align: 'right' });

  // Divider
  doc.setDrawColor(...orange);
  doc.line(5, 72, 143, 72);

  // Table header
  doc.setFillColor(245, 245, 245);
  doc.rect(5, 73, 138, 8, 'F');
  doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(...dark);
  doc.text('الاجمالي', 143, 79, { align: 'right' });
  doc.text('سعرالوحده', 118, 79, { align: 'right' });
  doc.text('الكميه', 94, 79, { align: 'right' });
  doc.text('وصف المنتج', 68, 79, { align: 'right' });
  doc.text('كود المنتج', 30, 79, { align: 'right' });

  // Product rows
  let y = 90;
  doc.setFont('helvetica','normal'); doc.setFontSize(8);

  (o.products || []).forEach((p, idx) => {
    const pr = cache.products.find(pp => pp.code === p.code);
    const name = (pr?.name || p.code).substring(0, 22);
    const qty = parseInt(p.qty || 1);
    const unit = parseFloat(p.sell_price || 0);
    const line = unit * qty;
    if (idx % 2 === 0) {
      doc.setFillColor(252, 252, 252);
      doc.rect(5, y - 6, 138, 8, 'F');
    }
    doc.setTextColor(...dark);
    doc.text(Math.round(line).toString(), 143, y, { align: 'right' });
    doc.text(Math.round(unit).toString(), 118, y, { align: 'right' });
    doc.text(qty.toString(), 94, y, { align: 'right' });
    doc.text(name, 68, y, { align: 'right' });
    doc.text(p.code || '', 30, y, { align: 'right' });
    y += 9;
  });

  // Shipping row
  const shipCost = parseFloat(o.actual_shipping || 0) || parseFloat(o.est_shipping || 0);
  if (shipCost > 0) {
    doc.setFillColor(252, 252, 252);
    doc.rect(5, y - 6, 138, 8, 'F');
    doc.setTextColor(...dark);
    doc.text(Math.round(shipCost).toString(), 143, y, { align: 'right' });
    doc.text(Math.round(shipCost).toString(), 118, y, { align: 'right' });
    doc.text('1', 94, y, { align: 'right' });
    doc.setTextColor(...orange);
    doc.text('شحن', 68, y, { align: 'right' });
    doc.setTextColor(...dark);
    doc.text('SHIP-001', 30, y, { align: 'right' });
    y += 9;
  }

  // Divider
  doc.setDrawColor(...orange);
  doc.line(5, y, 143, y);
  y += 9;

  // Grand total
  const grandTotal = parseFloat(o.total || 0) + shipCost;
  doc.setFont('helvetica','bold'); doc.setFontSize(10);
  doc.setTextColor(...orange);
  doc.text('جم ' + Math.round(grandTotal), 143, y, { align: 'right' });
  doc.setTextColor(...dark);
  doc.text('الاجمالي', 94, y, { align: 'right' });

  // Footer
  const fy = 185;
  doc.setFillColor(...dark);
  doc.rect(0, fy, 148, 25, 'F');

  doc.setTextColor(...orange);
  doc.setFontSize(11); doc.setFont('helvetica','bold');
  doc.text('الشغل عليك', 8, fy + 9);
  doc.text('و العده علينا', 8, fy + 17);

  doc.setTextColor(...white);
  doc.setFontSize(7); doc.setFont('helvetica','normal');
  doc.text('للتواصل كلمنا علي :', 143, fy + 7, { align: 'right' });
  doc.setTextColor(...orange);
  doc.setFontSize(9);
  doc.text('01034482071', 143, fy + 13, { align: 'right' });
  doc.setTextColor(...white);
  doc.setFontSize(7);
  doc.text('Support@protechstores.com', 143, fy + 19, { align: 'right' });

  // Orange bottom border
  doc.setFillColor(...orange);
  doc.rect(0, 208, 148, 2, 'F');

  doc.save('Protech-Invoice-' + o.code + '.pdf');
}
