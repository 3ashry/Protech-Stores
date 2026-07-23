// ═══════════════════════════════════════════════════════════════════
//  BULK SELL-PRICE SYNC (upload a file with codes + new selling prices)
//
//  Flow:
//    1. User picks a file (Excel / CSV / PDF).
//    2. Parser extracts { code, price } pairs.
//    3. Preview shows: matched with old→new price, unmatched codes.
//    4. Apply PATCHes each matched product's `price` (NOT buy_price).
//       Buy price / qty / everything else stays exactly as it is.
// ═══════════════════════════════════════════════════════════════════

const _SP_PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const _SP_PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const _SP_BIDI_RE = /[‪-‮⁦-⁩‎‏]/g;

let _spPending = [];
let _spParsed = [];

function _spEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _spFmt(n) {
  const x = Number(n || 0);
  return x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _spLoadPdfJs() {
  return new Promise((resolve, reject) => {
    if (window['pdfjsLib']) return resolve(window['pdfjsLib']);
    const s = document.createElement('script');
    s.src = _SP_PDFJS_SRC;
    s.onload = () => {
      try { window['pdfjsLib'].GlobalWorkerOptions.workerSrc = _SP_PDFJS_WORKER; } catch (_) {}
      resolve(window['pdfjsLib']);
    };
    s.onerror = () => reject(new Error('Could not load PDF parser'));
    document.head.appendChild(s);
  });
}

async function _spParseXlsx(file) {
  if (typeof XLSX === 'undefined') throw new Error('Excel parser not loaded');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const rows = [];
  for (const name of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    for (const r of aoa) {
      let code = null, price = null;
      for (const cell of r) {
        const s = String(cell == null ? '' : cell).trim();
        if (!code && /^[A-Z][A-Z0-9\-]{2,25}$/i.test(s)) code = s.toUpperCase();
      }
      if (!code) continue;
      for (const cell of r) {
        const s = String(cell == null ? '' : cell).trim();
        if (s.toUpperCase() === code) continue;
        const num = parseFloat(s.replace(/,/g, ''));
        if (!Number.isNaN(num) && num > 0 && num < 1e7 && (price == null || num > price)) price = num;
      }
      if (code && price != null) rows.push({ code, price });
    }
  }
  const map = new Map();
  for (const r of rows) map.set(r.code, r.price);
  return { rows: Array.from(map, ([code, price]) => ({ code, price })) };
}

async function _spParsePdf(file) {
  const pdfjs = await _spLoadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let prevY = null;
    for (const it of content.items) {
      const y = it.transform ? it.transform[5] : null;
      if (prevY != null && y != null && Math.abs(prevY - y) > 3) text += '\n';
      text += (it.str || '') + ' ';
      prevY = y;
    }
    text += '\n';
  }
  return _spRowsFromText(text);
}

async function _spParseCsv(file) { return _spRowsFromText(await file.text()); }

function _spRowsFromText(text) {
  const cleaned = String(text).replace(_SP_BIDI_RE, '');
  const CODE_RE = /(?<![A-Z0-9])([A-Z][A-Z0-9\-]{2,25})(?![A-Z0-9])/;
  const PRICE_RE = /(\d{1,6}(?:\.\d{1,2})?)/g;
  const rows = [];
  for (const ln of cleaned.split(/\r?\n/)) {
    const cm = ln.match(CODE_RE);
    if (!cm) continue;
    const prices = [];
    let m; PRICE_RE.lastIndex = 0;
    while ((m = PRICE_RE.exec(ln))) prices.push(parseFloat(m[1]));
    const valid = prices.filter(p => p > 0 && p < 1e7);
    if (!valid.length) continue;
    rows.push({ code: cm[1].toUpperCase(), price: Math.max(...valid) });
  }
  const map = new Map();
  for (const r of rows) map.set(r.code, r.price);
  return { rows: Array.from(map, ([code, price]) => ({ code, price })) };
}

async function _spParseAny(file) {
  const n = String(file.name || '').toLowerCase();
  if (n.endsWith('.pdf')) return _spParsePdf(file);
  if (n.endsWith('.xlsx') || n.endsWith('.xls')) return _spParseXlsx(file);
  return _spParseCsv(file);
}

// ── UI ─────────────────────────────────────────────────────────────

function _openSellPricePreview() {
  document.getElementById('sp-mount')?.remove();
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div id="sp-mount" style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px">
      <div style="background:#fff;color:#111;max-width:900px;width:100%;max-height:92vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #e5e7eb">
          <strong style="font-size:16px">Sync selling prices from a file</strong>
          <button type="button" onclick="_closeSellPricePreview()" style="border:0;background:transparent;font-size:22px;cursor:pointer;color:#666">×</button>
        </div>
        <div style="padding:18px;overflow:auto;flex:1">
          <div>
            <label style="display:block;font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">
              Price file (Excel / CSV / PDF) — 2 columns: <b>Code</b> + <b>Price</b>
            </label>
            <input type="file" id="sp-file"
                   accept=".pdf,.xlsx,.xls,.csv,.txt"
                   onchange="_onSellPriceChosen(event)"
                   style="width:100%;padding:8px;border:1px dashed #d1d5db;border-radius:8px;background:#fafafa">
          </div>
          <div style="margin-top:10px;font-size:12px;color:#666">
            Updates the <b>sell price</b> (what customers pay) only. Buy price, quantity, name, images — nothing else is touched. Matching is exact code (case-insensitive, trimmed).
          </div>
          <div id="sp-status" style="margin-top:14px;color:#666;font-size:13px">Waiting for a file…</div>
          <div id="sp-preview" style="margin-top:14px"></div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid #e5e7eb;background:#fafafa">
          <button type="button" onclick="_closeSellPricePreview()" style="padding:8px 14px;border:1px solid #d1d5db;background:#fff;border-radius:8px;cursor:pointer">Cancel</button>
          <button type="button" id="sp-apply-btn" disabled
                  onclick="_applySellPriceUpdates()"
                  style="padding:8px 14px;border:0;background:#d1d5db;color:#fff;border-radius:8px;cursor:not-allowed;font-weight:700">
            Choose a file first
          </button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap.firstElementChild);
}

function _closeSellPricePreview() {
  document.getElementById('sp-mount')?.remove();
  _spPending = []; _spParsed = [];
}

async function _onSellPriceChosen(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('sp-status');
  const previewEl = document.getElementById('sp-preview');
  previewEl.innerHTML = '';
  statusEl.innerHTML = `⏳ Parsing <code>${_spEsc(file.name)}</code>…`;
  try {
    const { rows } = await _spParseAny(file);
    _spParsed = rows;
    statusEl.innerHTML = `<span style="color:#166534;font-weight:700">✅ Parsed ${rows.length} rows from ${_spEsc(file.name)}.</span>`;
    _spRefreshPreview();
  } catch (e) {
    console.error(e);
    statusEl.innerHTML = `<span style="color:#dc2626;font-weight:700">❌ Could not parse: ${_spEsc(e.message || e)}</span>`;
    _spPending = []; _spUpdateBtn(0);
  }
}

function _spRefreshPreview() {
  if (!_spParsed.length) return;
  const previewEl = document.getElementById('sp-preview');
  const dbByCode = new Map();
  for (const p of (cache.products || [])) {
    const k = String(p.code || '').toUpperCase().trim();
    if (k) dbByCode.set(k, p);
  }
  const fileCodes = new Set();
  const changes = [], unchanged = [], unmatched = [];
  for (const { code, price } of _spParsed) {
    const c = String(code).toUpperCase().trim();
    fileCodes.add(c);
    const newPrice = Math.round(Number(price) * 100) / 100;
    const p = dbByCode.get(c);
    if (!p) { unmatched.push({ code: c, newPrice }); continue; }
    const oldPrice = Math.round(Number(p.price || 0) * 100) / 100;
    if (Math.abs(oldPrice - newPrice) < 0.005) unchanged.push({ code: c, price: oldPrice });
    else changes.push({ product: p, oldPrice, newPrice });
  }
  const dbNotInFile = [];
  for (const c of dbByCode.keys()) if (!fileCodes.has(c)) dbNotInFile.push(c);

  _spPending = changes.map(c => ({ id: c.product.id, code: c.product.code, newPrice: c.newPrice }));

  const chgRows = changes.length
    ? changes.slice(0, 500).map(c => `
        <tr>
          <td style="padding:6px 8px"><span style="background:#fed7aa;color:#7c2d12;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700">${_spEsc(c.product.code)}</span></td>
          <td style="padding:6px 8px;font-size:12px">${_spEsc(c.product.name || '')}</td>
          <td style="padding:6px 8px;text-align:end">${_spFmt(c.oldPrice)}</td>
          <td style="padding:6px 8px;text-align:end;color:#16a34a;font-weight:700">${_spFmt(c.newPrice)}</td>
          <td style="padding:6px 8px;text-align:end;font-size:11px;color:${c.newPrice > c.oldPrice ? '#dc2626' : '#16a34a'}">${(c.newPrice - c.oldPrice).toFixed(2)}</td>
        </tr>`).join('')
    : `<tr><td colspan="5" style="text-align:center;color:#666;padding:12px">No prices need updating</td></tr>`;

  const unmatchedBlock = unmatched.length
    ? `<div style="margin-top:12px;background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:10px">
         <div style="font-weight:800;color:#92400e;margin-bottom:6px">⚠️ ${unmatched.length} file codes not in your store:</div>
         <div style="font-family:monospace;font-size:12px;max-height:140px;overflow:auto;white-space:pre-wrap;user-select:all;background:#fff;padding:8px;border-radius:6px">${_spEsc(unmatched.map(u => u.code).join('\n'))}</div>
       </div>` : '';

  previewEl.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
      <div style="background:#dcfce7;border-radius:8px;padding:10px;text-align:center"><div style="font-size:20px;font-weight:800;color:#166534">${changes.length}</div><div style="font-size:11px;color:#166534">Will update</div></div>
      <div style="background:#dbeafe;border-radius:8px;padding:10px;text-align:center"><div style="font-size:20px;font-weight:800;color:#1e40af">${unchanged.length}</div><div style="font-size:11px;color:#1e40af">Already match</div></div>
      <div style="background:#fef3c7;border-radius:8px;padding:10px;text-align:center"><div style="font-size:20px;font-weight:800;color:#92400e">${unmatched.length}</div><div style="font-size:11px;color:#92400e">Not in store</div></div>
      <div style="background:#f3f4f6;border-radius:8px;padding:10px;text-align:center"><div style="font-size:20px;font-weight:800;color:#374151">${dbNotInFile.length}</div><div style="font-size:11px;color:#374151">Not in file</div></div>
    </div>
    <div style="max-height:52vh;overflow:auto;border:1px solid #e5e7eb;border-radius:8px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead style="background:#f9fafb;position:sticky;top:0"><tr>
          <th style="text-align:start;padding:8px">Code</th>
          <th style="text-align:start;padding:8px">Name</th>
          <th style="text-align:end;padding:8px">Old price</th>
          <th style="text-align:end;padding:8px">New price</th>
          <th style="text-align:end;padding:8px">Δ</th>
        </tr></thead>
        <tbody>${chgRows}</tbody>
      </table>
    </div>
    ${unmatchedBlock}`;
  _spUpdateBtn(changes.length);
}

function _spUpdateBtn(n) {
  const btn = document.getElementById('sp-apply-btn');
  if (!btn) return;
  const enabled = n > 0;
  btn.disabled = !enabled;
  btn.textContent = enabled ? `Apply ${n} update${n === 1 ? '' : 's'}` : (n === 0 && _spParsed.length ? 'Nothing to apply' : 'Choose a file first');
  btn.style.background = enabled ? '#f97316' : '#d1d5db';
  btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
}

async function _applySellPriceUpdates() {
  const btn = document.getElementById('sp-apply-btn');
  if (!btn) return;
  const items = _spPending.slice();
  if (!items.length) return;
  btn.disabled = true;
  btn.style.background = '#d1d5db'; btn.style.cursor = 'not-allowed';
  const total = items.length;
  let done = 0, failed = 0, failedCodes = [];
  for (const it of items) {
    btn.textContent = `Applying ${++done}/${total}…`;
    try {
      await dbUpdate('products', it.id, { price: it.newPrice });
      const i = cache.products.findIndex(p => p.id === it.id);
      if (i >= 0) cache.products[i] = { ...cache.products[i], price: it.newPrice };
    } catch (e) {
      failed++; failedCodes.push(it.code);
      console.warn('sell price update failed for', it.code, e);
    }
  }
  try { renderInventory(); } catch (_) {}
  _closeSellPricePreview();
  if (failed) alert(`Done: ${total - failed} updated, ${failed} failed.\nFailed:\n${failedCodes.join(', ')}`);
  else if (typeof showToast === 'function') showToast(`✅ Updated sell price for ${total} products`);
  else alert(`✅ Updated sell price for ${total} products`);
}
