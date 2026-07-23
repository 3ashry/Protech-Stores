// ═══════════════════════════════════════════════════════════════════
//  BULK INVENTORY SYNC (upload a stock-take file — El Ashry جرد format
//  or any file with a code column + quantity column)
//
//  Flow:
//    1. User picks a file (PDF / XLSX / XLS / CSV).
//    2. Parser extracts { code, qty } pairs.
//    3. Preview shows: matched codes with old qty → new qty,
//       codes in file but not in store, and store products missing
//       from the file (marked so you can decide if they should go to 0).
//    4. Apply PATCHes only matched products' qty via the existing admin JWT.
//       Store products not in the file are NEVER touched unless you tick
//       the "also set missing products' qty to 0" box.
// ═══════════════════════════════════════════════════════════════════

// pdf.js is shared with bulk_buy_price.js — load on demand if not there.
const _INV_PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const _INV_PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let _invPending = [];
let _invParsed = [];

function _invEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _invLoadPdfJs() {
  return new Promise((resolve, reject) => {
    if (window['pdfjsLib']) return resolve(window['pdfjsLib']);
    const s = document.createElement('script');
    s.src = _INV_PDFJS_SRC;
    s.onload = () => {
      try { window['pdfjsLib'].GlobalWorkerOptions.workerSrc = _INV_PDFJS_WORKER; } catch (_) {}
      resolve(window['pdfjsLib']);
    };
    s.onerror = () => reject(new Error('Could not load PDF parser (check internet)'));
    document.head.appendChild(s);
  });
}

const _INV_BIDI_RE = /[‪-‮⁦-⁩‎‏]/g;
const _INV_AR_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
function _invArToEn(s) { return String(s).replace(/[٠-٩]/g, d => _INV_AR_DIGITS[d]); }

async function _invParsePdfFile(file) {
  const pdfjs = await _invLoadPdfJs();
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
  return _invRowsFromText(text);
}

// El Ashry جرد format:
//   Every product row starts with "0.00 <digits>..." (the empty invoice columns)
//   and contains a balance decimal (الرصيد). The Latin product code appears on
//   the same line or wraps to the next. Category-header rows (اكسسوار / استيراد)
//   have no code and are skipped.
// Generic fallback: any line where we see both a Latin code and one non-zero
// decimal or integer becomes a row (qty = that number).
function _invRowsFromText(rawText) {
  const cleaned = _invArToEn(String(rawText).replace(_INV_BIDI_RE, ''));
  const lines = cleaned.split(/\r?\n/);
  const ROW_START = /^\s*0\.00\s+\d/;
  const CODE_RE = /(?:^|[^A-Z0-9])([A-Z][A-Z0-9\-]{2,25})(?![A-Z0-9])/g;
  const DEC_RE = /(\d{1,5}\.\d{2})/g;
  const INT_RE = /(?:^|[^\d.])(\d{1,5})(?![\d.])/g;

  const isRowStart = lines.map(l => ROW_START.test(l));
  const strictRows = isRowStart.some(Boolean);
  const findCode = (line) => {
    CODE_RE.lastIndex = 0;
    let m;
    while ((m = CODE_RE.exec(line))) {
      const c = m[1];
      if (c !== 'TOTAL' && c !== 'WADFOW' && c !== 'WADFO') return c;
    }
    return null;
  };

  const rows = [];

  // Collect ALL code candidates from a line (in order), not just the first.
  const findAllCodes = (line) => {
    CODE_RE.lastIndex = 0;
    const out = []; let m;
    while ((m = CODE_RE.exec(line))) {
      const c = m[1];
      if (c !== 'TOTAL' && c !== 'WADFOW' && c !== 'WADFO') out.push(c);
    }
    return out;
  };

  if (strictRows) {
    // Strict El-Ashry-جرد mode. Every row occupies a "body" that starts at a
    // row-start line ("0.00 ..." — the empty invoice columns) and ends just
    // before the next row-start. Some rows fit on one line, others wrap onto
    // 2-4 lines. WADFOW-brand rows in particular put the quantity/name on the
    // line AFTER the row-start, so we MUST look at the whole body — not just
    // the row-start line — for both qty and code.
    const rowStartIdx = [];
    for (let k = 0; k < lines.length; k++) if (isRowStart[k]) rowStartIdx.push(k);
    for (let idx = 0; idx < rowStartIdx.length; idx++) {
      const i = rowStartIdx[idx];
      const end = idx + 1 < rowStartIdx.length ? rowStartIdx[idx + 1] : lines.length;
      const body = lines.slice(i, end);

      // qty = last non-zero NN.NN decimal from ANY body line
      const allDecs = [];
      for (const bl of body) {
        DEC_RE.lastIndex = 0;
        let m;
        while ((m = DEC_RE.exec(bl))) allDecs.push(parseFloat(m[1]));
      }
      const nz = allDecs.filter(d => d !== 0.00);
      const qty = nz.length ? nz[nz.length - 1] : 0;

      // code: prefer wrap-line codes (body[1..]) so we skip spec tokens like
      // "PSI160" or "MAX" that sometimes appear in the row-start's name text.
      const wrapCodes = [];
      for (const bl of body.slice(1)) wrapCodes.push(...findAllCodes(bl));
      const inlineCodes = findAllCodes(body[0]);
      const code = wrapCodes.length ? wrapCodes[wrapCodes.length - 1]
                 : (inlineCodes.length ? inlineCodes[inlineCodes.length - 1] : null);
      if (code) rows.push({ code, qty });
    }
  } else {
    // Generic fallback: pair code + first meaningful integer on the same line.
    for (const ln of lines) {
      const code = findCode(ln);
      if (!code) continue;
      DEC_RE.lastIndex = 0;
      const decs = []; let m;
      while ((m = DEC_RE.exec(ln))) decs.push(parseFloat(m[1]));
      const nz = decs.filter(d => d !== 0.00);
      if (nz.length) { rows.push({ code, qty: nz[nz.length - 1] }); continue; }
      INT_RE.lastIndex = 0;
      const ints = []; let mi;
      while ((mi = INT_RE.exec(ln))) ints.push(parseInt(mi[1], 10));
      const clean = ints.filter(x => x >= 0 && x < 100000 && x !== 0);
      if (clean.length) rows.push({ code, qty: clean[clean.length - 1] });
    }
  }

  // Dedup — sum quantities if same code appears twice in the file.
  const agg = new Map();
  for (const r of rows) agg.set(r.code.toUpperCase(), (agg.get(r.code.toUpperCase()) || 0) + r.qty);
  return { rows: Array.from(agg, ([code, qty]) => ({ code, qty })) };
}

async function _invParseXlsxFile(file) {
  if (typeof XLSX === 'undefined') throw new Error('Excel parser not loaded');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const rows = [];
  for (const name of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    for (const r of aoa) {
      let code = null, qty = null;
      for (const cell of r) {
        const s = String(cell == null ? '' : cell).trim();
        if (!code && /^[A-Z][A-Z0-9\-]{2,25}$/.test(s)) code = s.toUpperCase();
      }
      if (!code) continue;
      // qty = the largest positive numeric cell in the row (excluding the code position).
      for (const cell of r) {
        const s = String(cell == null ? '' : cell).trim();
        if (s === code) continue;
        const num = parseFloat(s.replace(/,/g, ''));
        if (!Number.isNaN(num) && num >= 0 && num < 100000) {
          if (qty == null || num > qty) qty = num;
        }
      }
      if (code && qty != null) rows.push({ code, qty });
    }
  }
  const agg = new Map();
  for (const r of rows) agg.set(r.code, (agg.get(r.code) || 0) + r.qty);
  return { rows: Array.from(agg, ([code, qty]) => ({ code, qty })) };
}

async function _invParseCsvFile(file) {
  const text = await file.text();
  return _invRowsFromText(text);
}

async function _invParseAnyFile(file) {
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.pdf')) return _invParsePdfFile(file);
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return _invParseXlsxFile(file);
  return _invParseCsvFile(file);
}

// ── UI ─────────────────────────────────────────────────────────────

function _openInventorySync() {
  document.getElementById('inv-sync-mount')?.remove();
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div id="inv-sync-mount" style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px">
      <div style="background:#fff;color:#111;max-width:900px;width:100%;max-height:92vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #e5e7eb">
          <strong style="font-size:16px">Sync inventory (stock take)</strong>
          <button type="button" onclick="_closeInventorySync()" style="border:0;background:transparent;font-size:22px;cursor:pointer;color:#666">×</button>
        </div>
        <div style="padding:18px;overflow:auto;flex:1">
          <div>
            <label style="display:block;font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">
              Stock-take file (PDF, Excel, or CSV) — needs a column of product codes and a column of quantities
            </label>
            <input type="file" id="inv-sync-file"
                   accept=".pdf,.xlsx,.xls,.csv,.txt,application/pdf"
                   onchange="_onInventoryFileChosen(event)"
                   style="width:100%;padding:8px;border:1px dashed #d1d5db;border-radius:8px;background:#fafafa">
          </div>
          <div style="margin-top:10px;font-size:12px;color:#666">
            Matching is by exact <code>code</code> (case-insensitive, trimmed; hyphens preserved).
            Only products whose <em>quantity actually changes</em> will be updated. Nothing else is touched — buy price, sell price, name, everything else stays exactly as it is.
          </div>
          <label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;cursor:pointer">
            <input type="checkbox" id="inv-sync-zero-missing" onchange="_invRefreshPreview()">
            <span>Also set store products NOT in the file to qty = 0
              <span style="color:#dc2626;font-weight:700">(destructive — leave off unless the file is your <u>full</u> warehouse stock)</span>
            </span>
          </label>
          <div id="inv-sync-status" style="margin-top:14px;color:#666;font-size:13px">Waiting for a file…</div>
          <div id="inv-sync-preview" style="margin-top:14px"></div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid #e5e7eb;background:#fafafa">
          <button type="button" onclick="_closeInventorySync()" style="padding:8px 14px;border:1px solid #d1d5db;background:#fff;border-radius:8px;cursor:pointer">Cancel</button>
          <button type="button" id="inv-sync-apply-btn" disabled
                  onclick="_applyInventorySync()"
                  style="padding:8px 14px;border:0;background:#d1d5db;color:#fff;border-radius:8px;cursor:not-allowed;font-weight:700">
            Choose a file first
          </button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap.firstElementChild);
}

function _closeInventorySync() {
  document.getElementById('inv-sync-mount')?.remove();
  _invPending = [];
  _invParsed = [];
}

async function _onInventoryFileChosen(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('inv-sync-status');
  const previewEl = document.getElementById('inv-sync-preview');
  previewEl.innerHTML = '';
  statusEl.innerHTML = `⏳ Parsing <code>${_invEsc(file.name)}</code>…`;
  try {
    const { rows } = await _invParseAnyFile(file);
    _invParsed = rows;
    statusEl.innerHTML = `<span style="color:#166534;font-weight:700">✅ Parsed ${rows.length} products from ${_invEsc(file.name)}.</span>`;
    _invRefreshPreview();
  } catch (e) {
    console.error(e);
    statusEl.innerHTML = `<span style="color:#dc2626;font-weight:700">❌ Could not parse: ${_invEsc(e.message || e)}</span>`;
    _invPending = [];
    _invUpdateApplyBtn(0);
  }
}

function _invRefreshPreview() {
  if (!_invParsed.length) return;
  const previewEl = document.getElementById('inv-sync-preview');
  const zeroMissing = !!document.getElementById('inv-sync-zero-missing')?.checked;

  const dbByCode = new Map();
  for (const p of (cache.products || [])) {
    const k = String(p.code || '').toUpperCase().trim();
    if (k) dbByCode.set(k, p);
  }
  const dbCodes = new Set(dbByCode.keys());
  const fileCodes = new Set();

  const changes = [], unchanged = [], unmatched = [];
  for (const { code, qty } of _invParsed) {
    const c = String(code).toUpperCase().trim();
    fileCodes.add(c);
    const newQty = Math.max(0, Math.round(Number(qty) || 0));
    const p = dbByCode.get(c);
    if (!p) { unmatched.push({ code: c, newQty }); continue; }
    const oldQty = parseInt(p.qty || 0, 10);
    if (oldQty === newQty) unchanged.push({ code: c, qty: oldQty });
    else changes.push({ product: p, oldQty, newQty });
  }
  const zeroed = [];
  const dbNotInFile = [];
  for (const c of dbCodes) {
    if (!fileCodes.has(c)) {
      const p = dbByCode.get(c);
      const oldQty = parseInt(p.qty || 0, 10);
      if (zeroMissing && oldQty !== 0) {
        zeroed.push({ product: p, oldQty, newQty: 0 });
      }
      dbNotInFile.push(c);
    }
  }
  const allChanges = changes.concat(zeroed);
  _invPending = allChanges.map(c => ({ id: c.product.id, code: c.product.code, newQty: c.newQty }));

  const chgRows = allChanges.length
    ? allChanges.slice(0, 500).map(c => `
        <tr>
          <td style="padding:6px 8px"><span style="background:#fed7aa;color:#7c2d12;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700">${_invEsc(c.product.code)}</span></td>
          <td style="padding:6px 8px;font-size:12px">${_invEsc(c.product.name || '')}</td>
          <td style="padding:6px 8px;text-align:end">${c.oldQty}</td>
          <td style="padding:6px 8px;text-align:end;color:${c.newQty === 0 ? '#dc2626' : (c.newQty > c.oldQty ? '#16a34a' : '#f97316')};font-weight:700">${c.newQty}</td>
          <td style="padding:6px 8px;text-align:end;font-size:11px;color:${c.newQty >= c.oldQty ? '#16a34a' : '#dc2626'}">${c.newQty - c.oldQty > 0 ? '+' : ''}${c.newQty - c.oldQty}</td>
        </tr>`).join('')
      + (allChanges.length > 500 ? `<tr><td colspan="5" style="text-align:center;color:#666;padding:8px">…and ${allChanges.length - 500} more (all will be updated)</td></tr>` : '')
    : `<tr><td colspan="5" style="text-align:center;color:#666;padding:12px">No products need updating</td></tr>`;

  const unmatchedBlock = unmatched.length
    ? `<div style="margin-top:12px;background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:10px">
         <div style="font-weight:800;color:#92400e;margin-bottom:6px">⚠️ ${unmatched.length} file codes not in your store (add them manually if they should exist):</div>
         <div style="font-family:monospace;font-size:12px;max-height:140px;overflow:auto;white-space:pre-wrap;user-select:all;background:#fff;padding:8px;border-radius:6px">${_invEsc(unmatched.map(u => `${u.code}  qty=${u.newQty}`).join('\n'))}</div>
       </div>` : '';

  const orphanBlock = dbNotInFile.length
    ? `<div style="margin-top:8px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:8px;padding:10px">
         <div style="font-weight:700;color:#374151;margin-bottom:6px">ℹ️ ${dbNotInFile.length} store products not in the file ${zeroMissing ? '<span style="color:#dc2626">— will be set to 0</span>' : '(unchanged)'}:</div>
         <div style="font-family:monospace;font-size:11px;max-height:110px;overflow:auto;white-space:pre-wrap;user-select:all;background:#fff;padding:8px;border-radius:6px">${_invEsc(dbNotInFile.slice(0, 600).join('\n'))}${dbNotInFile.length > 600 ? '\n…' : ''}</div>
       </div>` : '';

  previewEl.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
      <div style="background:#dcfce7;border-radius:8px;padding:10px;text-align:center"><div style="font-size:20px;font-weight:800;color:#166534">${changes.length}${zeroed.length ? '+' + zeroed.length : ''}</div><div style="font-size:11px;color:#166534">Will update${zeroed.length ? ' (+ zeroed)' : ''}</div></div>
      <div style="background:#dbeafe;border-radius:8px;padding:10px;text-align:center"><div style="font-size:20px;font-weight:800;color:#1e40af">${unchanged.length}</div><div style="font-size:11px;color:#1e40af">Already match</div></div>
      <div style="background:#fef3c7;border-radius:8px;padding:10px;text-align:center"><div style="font-size:20px;font-weight:800;color:#92400e">${unmatched.length}</div><div style="font-size:11px;color:#92400e">Not in store</div></div>
      <div style="background:#f3f4f6;border-radius:8px;padding:10px;text-align:center"><div style="font-size:20px;font-weight:800;color:#374151">${dbNotInFile.length}</div><div style="font-size:11px;color:#374151">Not in file</div></div>
    </div>
    <div style="max-height:44vh;overflow:auto;border:1px solid #e5e7eb;border-radius:8px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead style="background:#f9fafb;position:sticky;top:0;z-index:1">
          <tr>
            <th style="text-align:start;padding:8px">Code</th>
            <th style="text-align:start;padding:8px">Name</th>
            <th style="text-align:end;padding:8px">Old qty</th>
            <th style="text-align:end;padding:8px">New qty</th>
            <th style="text-align:end;padding:8px">Δ</th>
          </tr>
        </thead>
        <tbody>${chgRows}</tbody>
      </table>
    </div>
    ${unmatchedBlock}
    ${orphanBlock}`;

  _invUpdateApplyBtn(_invPending.length);
}

function _invUpdateApplyBtn(n) {
  const btn = document.getElementById('inv-sync-apply-btn');
  if (!btn) return;
  const enabled = n > 0;
  btn.disabled = !enabled;
  btn.textContent = enabled ? `Apply ${n} update${n === 1 ? '' : 's'}` : (n === 0 && _invParsed.length ? 'Nothing to apply' : 'Choose a file first');
  btn.style.background = enabled ? '#f97316' : '#d1d5db';
  btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
}

async function _applyInventorySync() {
  const btn = document.getElementById('inv-sync-apply-btn');
  if (!btn) return;
  const items = _invPending.slice();
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
      await dbUpdate('products', it.id, { qty: it.newQty });
      const i = cache.products.findIndex(p => p.id === it.id);
      if (i >= 0) cache.products[i] = { ...cache.products[i], qty: it.newQty };
    } catch (e) {
      failed++;
      failedCodes.push(it.code);
      console.warn('inventory sync failed for', it.code, e);
    }
  }
  try { renderInventory(); } catch (_) {}
  _closeInventorySync();
  if (failed) {
    alert(`Done: ${total - failed} updated, ${failed} failed.\nFailed codes:\n${failedCodes.join(', ')}`);
  } else if (typeof showToast === 'function') {
    showToast(`✅ Updated qty for ${total} products`);
  } else {
    alert(`✅ Updated qty for ${total} products`);
  }
}
