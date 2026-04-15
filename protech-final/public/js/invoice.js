function printInvoice(id) {
  const o = cache.orders.find(x => x.id === id);
  if (!o) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });

  // ── HEADER BACKGROUND ──
  doc.setFillColor(242, 101, 34); // Protech orange
  doc.rect(0, 0, 148, 26, 'F');
  doc.setFillColor(45, 41, 38); // Protech dark
  doc.rect(0, 26, 148, 9, 'F');

  // ── LOGO P ──
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(6, 4, 16, 18, 2, 2, 'F');
  doc.setTextColor(242, 101, 34);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('P', 9.5, 17);

  // ── COMPANY NAME ──
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('PROTECH', 26, 14);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(255, 220, 200);
  doc.text('بروتيك — Professional Tools', 26, 20);

  // ── INVOICE LABEL (top right) ──
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('INVOICE', 142, 12, { align: 'right' });
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.text(o.code, 142, 18, { align: 'right' });

  // ── DARK STRIP TEXT ──
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text(`Date: ${o.date}`, 8, 31.5);
  doc.text(`Status: ${o.status}`, 74, 31.5, { align: 'center' });
  doc.text(`Shipping: ${o.ship_code || '—'}`, 142, 31.5, { align: 'right' });

  // ── CUSTOMER BOX ──
  doc.setFillColor(250, 246, 243);
  doc.roundedRect(8, 36, 132, 24, 2, 2, 'F');
  doc.setTextColor(122, 111, 104);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('BILL TO', 12, 42);
  doc.setTextColor(45, 41, 38);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(o.customer_name, 12, 49);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Phone: ${o.phone}`, 12, 55);
  doc.setFontSize(8);
  doc.text(`Est. Shipping: EGP ${fmt(o.est_shipping || 0)}`, 88, 49);
  doc.text(`Actual Shipping: EGP ${fmt(o.actual_shipping || 0)}`, 88, 55);

  // ── PRODUCTS TABLE HEADER ──
  doc.setFillColor(45, 41, 38);
  doc.rect(8, 63, 132, 9, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.text('PRODUCT', 11, 68.5);
  doc.text('QTY', 88, 68.5, { align: 'center' });
  doc.text('UNIT PRICE', 110, 68.5, { align: 'center' });
  doc.text('TOTAL', 138, 68.5, { align: 'right' });

  // ── PRODUCT ROWS ──
  doc.setTextColor(45, 41, 38);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  let y = 77;

  (o.products || []).forEach((p, idx) => {
    const pr = cache.products.find(pp => pp.code === p.code);
    const name = (pr?.name || p.code).substring(0, 34);
    const line = parseFloat(p.sell_price || 0) * parseInt(p.qty || 1);
    if (idx % 2 === 1) {
      doc.setFillColor(250, 246, 243);
      doc.rect(8, y - 5.5, 132, 8, 'F');
    }
    doc.setTextColor(45, 41, 38);
    doc.text(name, 11, y);
    doc.text(String(p.qty), 88, y, { align: 'center' });
    doc.text('EGP ' + fmt(p.sell_price), 110, y, { align: 'center' });
    doc.text('EGP ' + fmt(line), 138, y, { align: 'right' });
    y += 8;
  });

  // ── DIVIDER ──
  doc.setDrawColor(220, 210, 205);
  doc.line(8, y + 1, 140, y + 1);
  y += 7;

  // ── TOTALS ──
  const grandTotal = parseFloat(o.total || 0) + parseFloat(o.actual_shipping || 0);

  if (parseFloat(o.actual_shipping || 0) > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(45, 41, 38);
    doc.text('Order Subtotal:', 92, y);
    doc.text('EGP ' + fmt(o.total), 138, y, { align: 'right' });
    y += 7;
    doc.text('Actual Shipping:', 92, y);
    doc.text('EGP ' + fmt(o.actual_shipping), 138, y, { align: 'right' });
    y += 7;
  }

  // Grand total box
  doc.setFillColor(242, 101, 34);
  doc.roundedRect(88, y - 5, 52, 10, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('TOTAL:', 92, y + 1.5);
  doc.text('EGP ' + fmt(grandTotal), 138, y + 1.5, { align: 'right' });

  // ── FOOTER ──
  doc.setFillColor(45, 41, 38);
  doc.rect(0, 188, 148, 12, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.text('PROTECH', 74, 193, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(255, 200, 170);
  doc.text('Thank you for your order!  |  شكراً لتسوقك معنا 🔧', 74, 197.5, { align: 'center' });

  doc.save(`Protech-Invoice-${o.code}.pdf`);
}
