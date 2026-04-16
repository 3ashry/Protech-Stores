// ── UTILS ──
const fmt = n => parseFloat(n || 0).toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

// ── NAVIGATION ──
const SCREENS = ['home', 'inventory', 'orders', 'returns', 'financials', 'invoices'];
function go(id) {
  SCREENS.forEach(s => {
    document.getElementById('screen-' + s).classList.toggle('active', s === id);
  });
  document.querySelectorAll('#top-nav .nav-tab').forEach((t, i) => t.classList.toggle('active', SCREENS[i] === id));
  document.querySelectorAll('.bnav-btn').forEach((t, i) => t.classList.toggle('active', SCREENS[i] === id));
  renderAll();
}

// ── RENDER ALL ──
function renderAll() {
  renderHome();
  renderInventory();
  renderOrders();
  renderReturns();
  renderFinancials();
  renderInvoices();
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
        <strong style="font-size:13px">${f.order_code || f.orderCode || '—'}</strong>
        <span class="badge ${(f.general === 'Satisfied' || f.general === 'راضي') ? 'b-success' : 'b-danger'}">${f.general}</span>
      </div>
      <div class="fb-pills">
        <span class="badge b-gray">Service: ${f.service}</span>
        <span class="badge b-gray">Quality: ${f.quality}</span>
        <span class="badge b-gray">Delivery: ${f.delivery}</span>
        <span class="badge b-gray">Packing: ${f.packing}</span>
        <span class="badge ${(f.recommend === 'Yes' || f.recommend === 'أنصح') ? 'b-success' : 'b-danger'}">Recommend: ${f.recommend}</span>
      </div>
      ${f.comment ? `<div style="font-size:13px;color:var(--muted);font-style:italic;margin-top:6px">"${f.comment}"</div>` : ''}
    </div>`).join('');
}

// ── INVENTORY ──
function renderInventory() {
  const ps = cache.products;
  const oos = ps.filter(p => parseInt(p.qty || 0) === 0).length;
  const low = ps.filter(p => parseInt(p.qty || 0) > 0 && parseInt(p.qty || 0) <= 5).length;
  const totalVal = ps.reduce((a, p) => a + parseFloat(p.price || 0) * parseInt(p.qty || 0), 0);

  document.getElementById('inv-stats').innerHTML = `
    <div class="stat-card orange"><div class="stat-val">${ps.length}</div><div class="stat-label">Total Products</div></div>
    <div class="stat-card red"><div class="stat-val">${oos}</div><div class="stat-label">Out of Stock</div></div>
    <div class="stat-card blue"><div class="stat-val">${low}</div><div class="stat-label">Low Stock ≤5</div></div>
    <div class="stat-card green"><div class="stat-val">EGP ${fmt(totalVal)}</div><div class="stat-label">Inventory Value</div></div>`;

  document.getElementById('inv-tbody').innerHTML = ps.length ? ps.map(p => `
    <tr>
      <td><span class="badge b-orange">${p.code}</span></td>
      <td><strong>${p.name}</strong></td>
      <td><span class="badge ${parseInt(p.qty || 0) === 0 ? 'b-danger' : parseInt(p.qty || 0) <= 5 ? 'b-warning' : 'b-success'}">${p.qty}</span></td>
      <td>EGP ${fmt(p.price)}</td>
      <td><div class="actions">
        <button class="btn btn-ghost btn-xs" onclick="editProduct('${p.id}')">Edit</button>
        <button class="btn btn-danger btn-xs" onclick="delProduct('${p.id}')">Remove</button>
      </div></td>
    </tr>`).join('') : '<tr><td colspan="5"><div class="empty"><div class="empty-icon">📦</div>No products yet. Add your first product.</div></td></tr>';
}

// ── PRODUCT CRUD ──
function openAddProduct() {
  document.getElementById('p-code').value = '';
  document.getElementById('p-name').value = '';
  document.getElementById('p-qty').value = '';
  document.getElementById('p-price').value = '';
  document.getElementById('p-idx').value = '';
  document.getElementById('m-product-title').textContent = 'Add Product';
  showModal('tpl-product');
}

function editProduct(id) {
  const p = cache.products.find(x => x.id === id);
  if (!p) return;
  document.getElementById('p-code').value = p.code;
  document.getElementById('p-name').value = p.name;
  document.getElementById('p-qty').value = p.qty;
  document.getElementById('p-price').value = p.price;
  document.getElementById('p-idx').value = id;
  document.getElementById('m-product-title').textContent = 'Edit Product';
  showModal('tpl-product');
}

async function saveProduct() {
  const code = document.getElementById('p-code').value.trim();
  const name = document.getElementById('p-name').value.trim();
  const qty = parseInt(document.getElementById('p-qty').value || 0);
  const price = parseFloat(document.getElementById('p-price').value || 0);
  if (!code || !name) { showToast('Please fill in code and name'); return; }

  const id = document.getElementById('p-idx').value;
  try {
    if (id) {
      await dbUpdate('products', id, { code, name, qty, price });
      const i = cache.products.findIndex(x => x.id === id);
      if (i >= 0) cache.products[i] = { ...cache.products[i], code, name, qty, price };
      showToast('Product updated ✓');
    } else {
      const data = { id: genId(), code, name, qty, price, created_at: new Date().toISOString() };
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
  const smap = { 'Processing': 'b-info', 'In Transit': 'b-warning', 'Delivered': 'b-success', 'Cancelled': 'b-danger', 'Returned': 'b-purple' };
  document.getElementById('orders-tbody').innerHTML = cache.orders.length ? cache.orders.map(o => `
    <tr>
      <td><span class="badge b-orange">${o.code}</span></td>
      <td><strong>${o.customer_name}</strong></td>
      <td>${o.phone}</td>
      <td>EGP ${fmt(o.total)}</td>
      <td><span class="badge ${smap[o.status] || 'b-gray'}">${o.status}</span></td>
      <td><div class="actions">
        <button class="btn btn-ghost btn-xs" onclick="viewOrder('${o.id}')">View</button>
        <button class="btn btn-dark btn-xs" onclick="editOrder('${o.id}')">Edit</button>
        <button class="btn btn-danger btn-xs" onclick="delOrder('${o.id}')">Delete</button>
      </div></td>
    </tr>`).join('') : '<tr><td colspan="6"><div class="empty"><div class="empty-icon">🛒</div>No orders yet</div></td></tr>';
}

let oPRows = [];

function openCreateOrder() {
  oPRows = [{ code: '', qty: 1, sell_price: '' }];
  ['o-name', 'o-phone', 'o-shipcode', 'o-shipest'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('o-idx').value = '';
  document.getElementById('m-order-title').textContent = 'New Order';
  renderPRows(); showModal('tpl-order');
}

function editOrder(id) {
  const o = cache.orders.find(x => x.id === id);
  if (!o) return;
  oPRows = (o.products || [{ code: '', qty: 1, sell_price: '' }]).map(p => ({ ...p }));
  document.getElementById('o-name').value = o.customer_name;
  document.getElementById('o-phone').value = o.phone;
  document.getElementById('o-shipcode').value = o.ship_code || '';
  document.getElementById('o-shipest').value = o.est_shipping || '';
  document.getElementById('o-idx').value = id;
  document.getElementById('m-order-title').textContent = 'Edit Order';
  renderPRows(); showModal('tpl-order');
}

function addProdRow() { oPRows.push({ code: '', qty: 1, sell_price: '' }); renderPRows(); }
function removePRow(i) { oPRows.splice(i, 1); renderPRows(); }
function updatePRow(i, f, v) { oPRows[i][f] = v; calcTotal(); }

function renderPRows() {
  document.getElementById('o-products').innerHTML = oPRows.map((r, i) => `
    <div class="op-row">
      <div class="op-row-grid">
        <div class="form-group" style="margin:0"><label>Product</label>
          <select onchange="updatePRow(${i},'code',this.value)">
            <option value="">Select product</option>
            ${cache.products.map(p => `<option value="${p.code}"${r.code === p.code ? ' selected' : ''}>${p.name} (${p.code})</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0"><label>Qty</label>
          <input type="number" min="1" value="${r.qty}" inputmode="numeric" onchange="updatePRow(${i},'qty',this.value)">
        </div>
        <div class="form-group" style="margin:0"><label>Sell Price</label>
          <input type="number" min="0" value="${r.sell_price}" placeholder="0" inputmode="decimal" onchange="updatePRow(${i},'sell_price',this.value)">
        </div>
        ${oPRows.length > 1 ? `<button class="btn btn-danger btn-xs" style="margin-bottom:2px" onclick="removePRow(${i})">✕</button>` : '<div></div>'}
      </div>
    </div>`).join('');
  calcTotal();
  // Update total when shipping changes
  const shipInput = document.getElementById('o-shipest');
  if (shipInput) shipInput.oninput = calcTotal;
}

function calcTotal() {
  const estShip = parseFloat(document.getElementById('o-shipest')?.value || 0);
  const t = oPRows.reduce((a, r) => a + parseFloat(r.sell_price || 0) * parseInt(r.qty || 1), 0);
  const totalWithShip = t + estShip;
  document.getElementById('o-total-disp').textContent = fmt(totalWithShip) + ' EGP';
}

async function saveOrder() {
  const customer_name = document.getElementById('o-name').value.trim();
  const phone = document.getElementById('o-phone').value.trim();
  const ship_code = document.getElementById('o-shipcode').value.trim();
  const est_shipping = parseFloat(document.getElementById('o-shipest').value || 0);
  if (!customer_name || !phone) { showToast('Please enter customer name and phone'); return; }
  if (!phoneOk(phone)) { showToast('Invalid Egyptian phone number (e.g. 01208198008)'); return; }

  // Check stock availability before saving
  for (const r of oPRows) {
    if (!r.code) continue;
    const prod = cache.products.find(p => p.code === r.code);
    if (!prod) { showToast('Product not found: ' + r.code); return; }
    const available = parseInt(prod.qty || 0);
    const ordered = parseInt(r.qty || 1);
    if (ordered > available) {
      showToast(`Not enough stock for "${prod.name}" — available: ${available}`);
      return;
    }
  }

  const total = oPRows.reduce((a, r) => a + parseFloat(r.sell_price || 0) * parseInt(r.qty || 1), 0);
  const id = document.getElementById('o-idx').value;
  try {
    if (id) {
      // Editing existing order — restore old quantities then deduct new ones
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
      const upd = { customer_name, phone, ship_code, est_shipping, products: oPRows, total };
      await dbUpdate('orders', id, upd);
      const i = cache.orders.findIndex(x => x.id === id);
      if (i >= 0) cache.orders[i] = { ...cache.orders[i], ...upd };
      showToast('Order updated ✓');
    } else {
      const data = { id: genId(), code: genCode('ORD'), customer_name, phone, ship_code, est_shipping, products: oPRows, total, status: 'Processing', date: today(), actual_shipping: 0, cancel_reason: '', created_at: new Date().toISOString() };
      await dbInsert('orders', data);
      cache.orders.unshift(data);
      showToast('Order created ✓');
    }

    // Deduct ordered quantities from inventory
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
  if (!confirm('Confirm you have received this order back in your warehouse? This will add the products back to inventory.')) return;
  const order = cache.orders.find(x => x.id === id);
  if (!order) return;
  try {
    // Add quantities back to inventory
    for (const op of (order.products || [])) {
      const pi = cache.products.findIndex(p => p.code === op.code);
      if (pi >= 0) {
        const restored = parseInt(cache.products[pi].qty || 0) + parseInt(op.qty || 1);
        cache.products[pi].qty = restored;
        await dbUpdate('products', cache.products[pi].id, { qty: restored });
      }
    }
    // Mark order as warehouse_confirmed so button disappears
    await dbUpdate('orders', id, { warehouse_confirmed: true });
    const i = cache.orders.findIndex(x => x.id === id);
    if (i >= 0) cache.orders[i].warehouse_confirmed = true;
    showToast('Stock restored to inventory ✓');
    closeModal();
    renderAll();
  } catch (e) { showToast('Error: ' + e.message); }
}

function viewOrder(id) {
  const o = cache.orders.find(x => x.id === id);
  if (!o) return;
  const statuses = ['Processing', 'In Transit', 'Delivered', 'Cancelled', 'Returned'];
  const prHtml = (o.products || []).map(p => {
    const pr = cache.products.find(pp => pp.code === p.code);
    const line = parseFloat(p.sell_price || 0) * parseInt(p.qty || 1);
    return `<tr><td>${pr?.name || p.code}</td><td style="text-align:center">${p.qty}</td><td>EGP ${fmt(p.sell_price)}</td><td>EGP ${fmt(line)}</td></tr>`;
  }).join('');
  const feedbackUrl = `${window.location.origin}/feedback.html?order=${o.code}`;
  const waText = encodeURIComponent(`أهلاً ${o.customer_name} 😊
شكراً لتسوقك من بروتيك! 🔧

نرجو منك تقييم تجربتك معنا من خلال الرابط ده:
${feedbackUrl}

رأيك يهمنا ويساعدنا نتحسن أكتر 🙏`);
  const waPhone = o.phone.startsWith('0') ? '2' + o.phone : o.phone;
  const waLink = `https://wa.me/${waPhone}?text=${waText}`;

  document.getElementById('m-detail-body').innerHTML = `
    <div class="detail-grid">
      <div><div class="detail-label">Order Code</div><strong>${o.code}</strong></div>
      <div><div class="detail-label">Date</div>${o.date}</div>
      <div><div class="detail-label">Customer</div><strong>${o.customer_name}</strong></div>
      <div><div class="detail-label">Phone</div>${o.phone}</div>
      <div><div class="detail-label">Shipping Code</div>${o.ship_code || '—'}</div>
      <div><div class="detail-label">Est. Shipping</div>EGP ${fmt(o.est_shipping || 0)}</div>
    </div>
    <div class="table-wrap" style="margin-bottom:14px">
      <table>
        <thead><tr><th>Product</th><th style="text-align:center">Qty</th><th>Unit Price</th><th>Subtotal</th></tr></thead>
        <tbody>${prHtml}</tbody>
      </table>
    </div>
    <div style="text-align:right;font-weight:800;font-size:15px;color:var(--orange);margin-bottom:16px">Order Total: EGP ${fmt(o.total)}</div>
    <div class="form-row">
      <div class="form-group"><label>Actual Shipping Cost (EGP)</label><input type="number" id="d-ship" value="${o.actual_shipping || ''}" placeholder="0" inputmode="decimal"></div>
      <div class="form-group"><label>Cancellation Reason</label><input id="d-reason" value="${o.cancel_reason || ''}" placeholder="If applicable"></div>
    </div>
    <div class="form-group"><label>Order Status</label>
      <select id="d-status">${statuses.map(s => `<option${o.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
      <button class="btn btn-primary" onclick="saveDetail('${id}')">Save Changes</button>
      ${o.status === 'Delivered' ? `<a href="${waLink}" target="_blank" class="btn btn-wa">WhatsApp Feedback</a>` : ''}
      ${o.status === 'Delivered' ? `<button class="btn btn-ghost" onclick="openFeedback('${o.code}')">Add Manual Feedback</button>` : ''}
      ${o.status === 'Cancelled' && !o.warehouse_confirmed ? `
        <button class="btn" style="background:#7c3aed;color:#fff;display:flex;align-items:center;gap:8px" onclick="confirmWarehouse('${id}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Confirm Received in Warehouse
        </button>` : ''}
      ${o.status === 'Cancelled' && o.warehouse_confirmed ? `<span style="color:#16a34a;font-size:13px;font-weight:700;display:flex;align-items:center;gap:6px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Stock Returned to Inventory</span>` : ''}
    </div>`;
  showModal('tpl-detail');
}

async function saveDetail(id) {
  const actual_shipping = parseFloat(document.getElementById('d-ship').value || 0);
  const cancel_reason = document.getElementById('d-reason').value;
  const status = document.getElementById('d-status').value;
  try {
    await dbUpdate('orders', id, { actual_shipping, cancel_reason, status });
    const i = cache.orders.findIndex(x => x.id === id);
    if (i >= 0) cache.orders[i] = { ...cache.orders[i], actual_shipping, cancel_reason, status };
    showToast('Order updated ✓'); closeModal(); renderAll();
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── RETURNS ──
function renderReturns() {
  const rets = cache.orders.filter(o => o.status === 'Cancelled');
  const totalShip = rets.reduce((a, o) => a + parseFloat(o.actual_shipping || 0), 0);
  document.getElementById('ret-stats').innerHTML = `
    <div class="stat-card red"><div class="stat-val">${rets.length}</div><div class="stat-label">Total Returns</div></div>
    <div class="stat-card orange"><div class="stat-val">EGP ${fmt(totalShip)}</div><div class="stat-label">Total Shipping Cost</div></div>`;
  document.getElementById('ret-tbody').innerHTML = rets.length ? rets.map(o => `
    <tr>
      <td><strong>${o.customer_name}</strong></td>
      <td>${o.phone}</td>
      <td>${o.cancel_reason || '—'}</td>
      <td>EGP ${fmt(o.actual_shipping || 0)}</td>
      <td>${o.date}</td>
    </tr>`).join('') : '<tr><td colspan="5"><div class="empty"><div class="empty-icon">↩️</div>No cancellations</div></td></tr>';
}

// ── FINANCIALS ──
function renderFinancials() {
  const orders = cache.orders;
  const delivered = orders.filter(o => o.status === 'Delivered');
  const cancelled = orders.filter(o => o.status === 'Cancelled');
  const totalCollected = delivered.reduce((a, o) => a + parseFloat(o.total || 0) + parseFloat(o.actual_shipping || 0), 0);
  const totalActualShip = delivered.reduce((a, o) => a + parseFloat(o.actual_shipping || 0), 0);
  const netFromBosta = totalCollected - totalActualShip;
  const retShipCost = cancelled.reduce((a, o) => a + parseFloat(o.actual_shipping || 0), 0);
  const buyingCost = orders.reduce((a, o) => a + (o.products || []).reduce((b, p) => {
    const pr = cache.products.find(pp => pp.code === p.code);
    return b + parseFloat(pr?.price || 0) * parseInt(p.qty || 1);
  }, 0), 0);
  const totalExp = cache.expenses.reduce((a, e) => a + parseFloat(e.amount || 0), 0);
  const netProfit = netFromBosta - retShipCost - buyingCost - totalExp;

  document.getElementById('fin-revenue').innerHTML = `
    <div class="fin-row"><span>Total collected (orders + shipping)</span><span class="fin-val">EGP ${fmt(totalCollected)}</span></div>
    <div class="fin-row"><span>Total actual shipping cost</span><span class="fin-val deduct">− EGP ${fmt(totalActualShip)}</span></div>
    <div class="fin-row subtotal"><span>Net amount from Bosta</span><span class="fin-val" style="color:var(--orange)">EGP ${fmt(netFromBosta)}</span></div>
    <div style="height:10px"></div>
    <div class="fin-row"><span>Return shipping cost</span><span class="fin-val deduct">− EGP ${fmt(retShipCost)}</span></div>
    <div class="fin-row"><span>Total buying price of all orders</span><span class="fin-val deduct">− EGP ${fmt(buyingCost)}</span></div>`;

  document.getElementById('exp-tbody').innerHTML = cache.expenses.length ? cache.expenses.map(e => `
    <tr>
      <td><span class="badge b-orange">${e.category}</span></td>
      <td>${e.description || '—'}</td>
      <td>EGP ${fmt(e.amount)}</td>
      <td>${e.date}</td>
      <td><button class="btn btn-danger btn-xs" onclick="delExpense('${e.id}')">✕</button></td>
    </tr>`).join('') : '<tr><td colspan="5"><div class="empty">No expenses recorded</div></td></tr>';

  document.getElementById('fin-net').innerHTML = `
    <div class="fin-row"><span>Net from Bosta</span><span class="fin-val">EGP ${fmt(netFromBosta)}</span></div>
    <div class="fin-row"><span>Total buying costs</span><span class="fin-val deduct">− EGP ${fmt(buyingCost)}</span></div>
    <div class="fin-row"><span>Total extra expenses</span><span class="fin-val deduct">− EGP ${fmt(totalExp)}</span></div>
    <div class="fin-row"><span>Return shipping costs</span><span class="fin-val deduct">− EGP ${fmt(retShipCost)}</span></div>
    <div class="fin-row ${netProfit >= 0 ? 'profit' : 'loss'}"><span>${netProfit >= 0 ? '🟢 Net Profit' : '🔴 Net Loss'}</span><span>EGP ${fmt(Math.abs(netProfit))}</span></div>`;
}

// ── EXPENSES ──
function openExpense() {
  document.getElementById('e-desc').value = '';
  document.getElementById('e-amt').value = '';
  showModal('tpl-expense');
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
      <td><span class="badge b-orange">${o.code}</span></td>
      <td>${o.customer_name}</td>
      <td>EGP ${fmt(o.total)}</td>
      <td><span class="badge b-info">${o.status}</span></td>
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
  // Prevent body scroll on mobile
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

// ── HELPERS ──
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── INIT ──
if (sessionStorage.getItem('pt_auth') === '1') {
  loadAll();
}
