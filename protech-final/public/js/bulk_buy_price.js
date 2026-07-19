// ═══════════════════════════════════════════════════════════════════
//  BULK BUY-PRICE IMPORT (upload a supplier price list)
//
//  Flow:
//    1. User picks a file (PDF / XLSX / XLS / CSV).
//    2. Parser extracts { code, price } pairs.
//    3. Preview shows: matched (old→new), unmatched file codes, and
//       store products not in the file. Formula:
//         buy_price = price × (1 − discount%)   (default 5%)
//    4. Apply PATCHes each matched product's buy_price via the existing admin JWT.
// ═══════════════════════════════════════════════════════════════════

// Loaded on-demand.
const PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let _bulkPending = [];    // pending {id, code, newBuy} to PATCH
let _bulkParsed = [];     // last-parsed [{code, price}] from the file

function _bulkEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _bulkFmt(n) {
  const x = Number(n || 0);
  return x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _loadPdfJs() {
  return new Promise((resolve, reject) => {
    if (window['pdfjsLib']) return resolve(window['pdfjsLib']);
    const s = document.createElement('script');
    s.src = PDFJS_SRC;
    s.onload = () => {
      try { window['pdfjsLib'].GlobalWorkerOptions.workerSrc = PDFJS_WORKER; } catch (_) {}
      resolve(window['pdfjsLib']);
    };
    s.onerror = () => reject(new Error('Could not load PDF parser (check internet)'));
    document.head.appendChild(s);
  });
}

// Strip Unicode bidi wrappers that Arabic PDFs sprinkle between Latin+digit tokens.
const _BIDI_RE = /[‪-‮⁦-⁩‎‏]/g;

async function _parsePdfFile(file) {
  const pdfjs = await _loadPdfJs();
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
    text += '\n\n';
  }
  return _rowsFromText(text);
}

// Turn arbitrary extracted text into {code, price} pairs. Handles the
// El Ashry layout (serial + type + code + name + carton + price + stock),
// but is forgiving — anything with a code near a NNNN.NN price on the same
// line becomes a row. Also stitches wrapped rows.
function _rowsFromText(rawText) {
  const cleaned = String(rawText).replace(_BIDI_RE, '');
  const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows = [];
  let carry = null;

  const CODE_RE = /\b([A-Z][A-Z0-9\-]{2,25})\b/;
  const PRICE_RE = /\b(\d{1,6}\.\d{2})\b/g;

  for (const ln of lines) {
    // El Ashry pattern first.
    const strict = ln.match(
      /^\s*\d{1,4}\s+(?:TOTAL|WADFOW|WADFO)\s+([A-Z][A-Z0-9\-]{2,25}).*?(\d{1,6}\.\d{2})/i
    );
    if (strict) { rows.push({ code: strict[1].toUpperCase(), price: parseFloat(strict[2]) }); carry = null; continue; }

    const cm = ln.match(CODE_RE);
    PRICE_RE.lastIndex = 0;
    const prices = [];
    let m; while ((m = PRICE_RE.exec(ln))) prices.push(parseFloat(m[1]));
    if (cm && prices.length) {
      // Sale price is virtually always the largest decimal on the row.
      rows.push({ code: cm[1].toUpperCase(), price: Math.max(...prices) });
      carry = null;
    } else if (cm && !prices.length) {
      carry = { code: cm[1].toUpperCase() };
    } else if (carry && prices.length) {
      rows.push({ code: carry.code, price: Math.max(...prices) });
      carry = null;
    }
  }

  // Dedup: keep the LAST occurrence, but report any code that appeared with
  // different prices so the user can review.
  const map = new Map(); const dupes = new Set();
  for (const r of rows) {
    if (map.has(r.code) && map.get(r.code) !== r.price) dupes.add(r.code);
    map.set(r.code, r.price);
  }
  return { rows: Array.from(map, ([code, price]) => ({ code, price })), dupes: Array.from(dupes) };
}

async function _parseXlsxFile(file) {
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
        if (!code && /^[A-Z][A-Z0-9\-]{2,25}$/.test(s)) code = s.toUpperCase();
      }
      if (!code) continue;
      for (const cell of r) {
        const s = String(cell == null ? '' : cell).trim();
        const num = parseFloat(s.replace(/,/g, ''));
        if (!Number.isNaN(num) && num > 0 && num < 1e7) {
          if (price == null || num > price) price = num;
        }
      }
      if (code && price != null) rows.push({ code, price });
    }
  }
  const map = new Map(); const dupes = new Set();
  for (const r of rows) {
    if (map.has(r.code) && map.get(r.code) !== r.price) dupes.add(r.code);
    map.set(r.code, r.price);
  }
  return { rows: Array.from(map, ([code, price]) => ({ code, price })), dupes: Array.from(dupes) };
}

async function _parseCsvFile(file) {
  const text = await file.text();
  return _rowsFromText(text);
}

async function _parseAnyFile(file) {
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.pdf')) return _parsePdfFile(file);
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return _parseXlsxFile(file);
  if (name.endsWith('.csv') || name.endsWith('.txt')) return _parseCsvFile(file);
  try { return await _parseCsvFile(file); }
  catch (_) { return _parseXlsxFile(file); }
}

// ── UI ─────────────────────────────────────────────────────────────

function _openBuyPricePreview() {
  document.getElementById('buy-price-mount')?.remove();
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div id="buy-price-mount" style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px">
      <div style="background:#fff;color:#111;max-width:900px;width:100%;max-height:92vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #e5e7eb">
          <strong style="font-size:16px">Import buy prices from a supplier file</strong>
          <button type="button" onclick="_closeBuyPricePreview()" style="border:0;background:transparent;font-size:22px;cursor:pointer;color:#666">×</button>
        </div>
        <div id="buy-price-body" style="padding:18px;overflow:auto;flex:1">
          <div style="display:grid;grid-template-columns:1fr 130px;gap:12px;align-items:end">
            <div>
              <label style="display:block;font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">
                Price list file (PDF, Excel, or CSV)
              </label>
              <input type="file" id="bulk-file-input"
                     accept=".pdf,.xlsx,.xls,.csv,.txt,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                     onchange="_onBulkFileChosen(event)"
                     style="width:100%;padding:8px;border:1px dashed #d1d5db;border-radius:8px;background:#fafafa">
            </div>
            <div>
              <label style="display:block;font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">Discount %</label>
              <input type="number" id="bulk-discount-input" min="0" max="100" step="0.1" value="5"
                     oninput="_bulkRefreshPreview()"
                     style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:14px">
            </div>
          </div>
          <div style="margin-top:10px;font-size:12px;color:#666">
            Formula: <code>buy_price = supplier_price × (1 − discount%)</code>, rounded to 2 decimals.
            Matching is by exact <code>code</code> (case-insensitive, trimmed; hyphens preserved).
            The file just needs a column of product codes and a column of prices — El Ashry's TOTAL/WADFOW PDF works out of the box.
          </div>
          <div id="bulk-status" style="margin-top:14px;color:#666;font-size:13px">Waiting for a file…</div>
          <div id="bulk-preview" style="margin-top:14px"></div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid #e5e7eb;background:#fafafa">
          <button type="button" onclick="_closeBuyPricePreview()" style="padding:8px 14px;border:1px solid #d1d5db;background:#fff;border-radius:8px;cursor:pointer">Cancel</button>
          <button type="button" id="buy-price-apply-btn" disabled
                  onclick="_applyBuyPriceUpdates()"
                  style="padding:8px 14px;border:0;background:#d1d5db;color:#fff;border-radius:8px;cursor:not-allowed;font-weight:700">
            Choose a file first
          </button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap.firstElementChild);
}

function _closeBuyPricePreview() {
  document.getElementById('buy-price-mount')?.remove();
  _bulkPending = [];
  _bulkParsed = [];
}

async function _onBulkFileChosen(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('bulk-status');
  const previewEl = document.getElementById('bulk-preview');
  previewEl.innerHTML = '';
  statusEl.innerHTML = `⏳ Parsing <code>${_bulkEsc(file.name)}</code>…`;
  try {
    const { rows, dupes } = await _parseAnyFile(file);
    _bulkParsed = rows;
    let msg = `✅ Parsed ${rows.length} rows from ${file.name}.`;
    if (dupes.length) msg += `  (${dupes.length} codes appeared multiple times with different prices — kept the last: ${dupes.slice(0, 8).join(', ')}${dupes.length > 8 ? '…' : ''})`;
    statusEl.innerHTML = `<span style="color:#166534;font-weight:700">${_bulkEsc(msg)}</span>`;
    _bulkRefreshPreview();
  } catch (e) {
    console.error(e);
    statusEl.innerHTML = `<span style="color:#dc2626;font-weight:700">❌ Could not parse: ${_bulkEsc(e.message || e)}</span>`;
    _bulkPending = [];
    _updateApplyButton(0);
  }
}

function _bulkRefreshPreview() {
  if (!_bulkParsed.length) return;
  const previewEl = document.getElementById('bulk-preview');
  const discPct = Math.max(0, Math.min(100, parseFloat(document.getElementById('bulk-discount-input').value || '0')));
  const factor = 1 - discPct / 100;

  const dbByCode = new Map();
  for (const p of (cache.products || [])) {
    const k = String(p.code || '').toUpperCase().trim();
    if (k) dbByCode.set(k, p);
  }
  const dbCodes = new Set(dbByCode.keys());
  const fileCodes = new Set();

  const changes = [], unchanged = [], unmatched = [];
  for (const { code, price } of _bulkParsed) {
    const c = String(code).toUpperCase().trim();
    fileCodes.add(c);
    const newBuy = Math.round(price * factor * 100) / 100;
    const p = dbByCode.get(c);
    if (!p) { unmatched.push({ code: c, price, newBuy }); continue; }
    const oldBuy = Number(p.buy_price || 0);
    if (Math.abs(oldBuy - newBuy) < 0.005) unchanged.push({ code: c, buy: oldBuy });
    else changes.push({ product: p, oldBuy, newBuy });
  }
  const dbNotInFile = [];
  for (const c of dbCodes) if (!fileCodes.has(c)) dbNotInFile.push(c);

  _bulkPending = changes.map(c => ({ id: c.product.id, code: c.product.code, newBuy: c.newBuy }));

  const chgRows = changes.length
    ? changes.slice(0, 500).map(c => `
        <tr>
          <td style="padding:6px 8px"><span style="background:#fed7aa;color:#7c2d12;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700">${_bulkEsc(c.product.code)}</span></td>
          <td style="padding:6px 8px;font-size:12px">${_bulkEsc(c.product.name || '')}</td>
          <td style="padding:6px 8px;text-align:end">${_bulkFmt(c.oldBuy)}</td>
          <td style="padding:6px 8px;text-align:end;color:#16a34a;font-weight:700">${_bulkFmt(c.newBuy)}</td>
          <td style="padding:6px 8px;text-align:end;font-size:11px;color:${c.newBuy > c.oldBuy ? '#dc2626' : '#16a34a'}">${(c.newBuy - c.oldBuy).toFixed(2)}</td>
        </tr>`).join('')
      + (changes.length > 500 ? `<tr><td colspan="5" style="text-align:center;color:#666;padding:8px">…and ${changes.length - 500} more (all will be updated)</td></tr>` : '')
    : `<tr><td colspan="5" style="text-align:center;color:#666;padding:12px">No products need updating</td></tr>`;

  const unmatchedBlock = unmatched.length
    ? `<div style="margin-top:12px;background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:10px">
         <div style="font-weight:800;color:#92400e;margin-bottom:6px">⚠️ ${unmatched.length} file codes not in your store (copy below to add manually):</div>
         <div style="font-family:monospace;font-size:12px;max-height:140px;overflow:auto;white-space:pre-wrap;user-select:all;background:#fff;padding:8px;border-radius:6px">${_bulkEsc(unmatched.map(u => u.code).join('\n'))}</div>
       </div>` : '';

  const orphanBlock = dbNotInFile.length
    ? `<div style="margin-top:8px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:8px;padding:10px">
         <div style="font-weight:700;color:#374151;margin-bottom:6px">ℹ️ ${dbNotInFile.length} store products not in the file (buy price unchanged):</div>
         <div style="font-family:monospace;font-size:11px;max-height:100px;overflow:auto;white-space:pre-wrap;user-select:all;background:#fff;padding:8px;border-radius:6px">${_bulkEsc(dbNotInFile.slice(0, 600).join('\n'))}${dbNotInFile.length > 600 ? '\n…' : ''}</div>
       </div>` : '';

  previewEl.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
      <div style="background:#dcfce7;border-radius:8px;padding:10px;text-align:center"><div style="font-size:20px;font-weight:800;color:#166534">${changes.length}</div><div style="font-size:11px;color:#166534">Will update</div></div>
      <div style="background:#dbeafe;border-radius:8px;padding:10px;text-align:center"><div style="font-size:20px;font-weight:800;color:#1e40af">${unchanged.length}</div><div style="font-size:11px;color:#1e40af">Already correct</div></div>
      <div style="background:#fef3c7;border-radius:8px;padding:10px;text-align:center"><div style="font-size:20px;font-weight:800;color:#92400e">${unmatched.length}</div><div style="font-size:11px;color:#92400e">Not in store</div></div>
      <div style="background:#f3f4f6;border-radius:8px;padding:10px;text-align:center"><div style="font-size:20px;font-weight:800;color:#374151">${dbNotInFile.length}</div><div style="font-size:11px;color:#374151">Not in file</div></div>
    </div>
    <div style="max-height:44vh;overflow:auto;border:1px solid #e5e7eb;border-radius:8px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead style="background:#f9fafb;position:sticky;top:0;z-index:1">
          <tr>
            <th style="text-align:start;padding:8px">Code</th>
            <th style="text-align:start;padding:8px">Name</th>
            <th style="text-align:end;padding:8px">Old buy</th>
            <th style="text-align:end;padding:8px">New buy</th>
            <th style="text-align:end;padding:8px">Δ</th>
          </tr>
        </thead>
        <tbody>${chgRows}</tbody>
      </table>
    </div>
    ${unmatchedBlock}
    ${orphanBlock}`;

  _updateApplyButton(changes.length);
}

function _updateApplyButton(n) {
  const btn = document.getElementById('buy-price-apply-btn');
  if (!btn) return;
  const enabled = n > 0;
  btn.disabled = !enabled;
  btn.textContent = enabled ? `Apply ${n} update${n === 1 ? '' : 's'}` : (n === 0 && _bulkParsed.length ? 'Nothing to apply' : 'Choose a file first');
  btn.style.background = enabled ? '#f97316' : '#d1d5db';
  btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
}

async function _applyBuyPriceUpdates() {
  const btn = document.getElementById('buy-price-apply-btn');
  if (!btn) return;
  const items = _bulkPending.slice();
  if (!items.length) return;
  btn.disabled = true;
  btn.style.background = '#d1d5db';
  btn.style.cursor = 'not-allowed';
  const total = items.length;
  let done = 0, failed = 0;
  const failedCodes = [];
  for (const it of items) {
    btn.textContent = `Applying ${++done}/${total}…`;
    try {
      await dbUpdate('products', it.id, { buy_price: it.newBuy });
      const i = cache.products.findIndex(p => p.id === it.id);
      if (i >= 0) cache.products[i] = { ...cache.products[i], buy_price: it.newBuy };
    } catch (e) {
      failed++;
      failedCodes.push(it.code);
      console.warn('bulk buy-price update failed for', it.code, e);
    }
  }
  try { renderInventory(); } catch (_) {}
  _closeBuyPricePreview();
  if (failed) {
    alert(`Done: ${total - failed} updated, ${failed} failed.\nFailed codes:\n${failedCodes.join(', ')}`);
  } else if (typeof showToast === 'function') {
    showToast(`✅ Updated buy price for ${total} products`);
  } else {
    alert(`✅ Updated buy price for ${total} products`);
  }
}
