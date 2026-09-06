// protech-final/public/api/bosta-wallet.js
// Probes Bosta for the wallet-transactions endpoint so we can auto-import
// bank-transfer payouts into the dashboard. Bosta's public docs don't spell
// this out, so this handler tries every plausible path it might live at
// and returns whichever one responds with non-empty JSON.
//
// Usage:
//   GET  /api/bosta-wallet             → probe all candidates, return the summary
//   GET  /api/bosta-wallet?raw=1       → include the full body of each response
//   POST /api/bosta-wallet             → same as GET (kept so the auto-sync loop
//                                        can share the /api/sync-status pattern)
//
// Once we know the winning endpoint + shape, the client can render
// "Received so far" directly from the API without asking the admin to
// paste transfer codes.
const BOSTA_API_KEY  = process.env.BOSTA_API_KEY;
const BOSTA_BASE_URL = process.env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2';

// Every candidate we know of or can reasonably guess. Order matters — the
// first one that returns something wallet-shaped wins.
const CANDIDATES = [
  { path: '/wallet',                           method: 'GET'  },
  { path: '/wallet/balance',                   method: 'GET'  },
  { path: '/wallet/transactions',              method: 'GET'  },
  { path: '/wallet/transactions/search',       method: 'POST', body: { limit: 50, page: 1, pageNumber: 1 } },
  { path: '/wallet/transactions?limit=50',     method: 'GET'  },
  { path: '/business/wallet',                  method: 'GET'  },
  { path: '/business/wallet/transactions',     method: 'GET'  },
  { path: '/business/wallet/transactions/search', method: 'POST', body: { limit: 50, page: 1 } },
  { path: '/invoices',                         method: 'GET'  },
  { path: '/invoices/search',                  method: 'POST', body: { limit: 50, page: 1 } },
  { path: '/cashcycles',                       method: 'GET'  },
  { path: '/cashcycles/search',                method: 'POST', body: { limit: 50, page: 1 } },
  { path: '/bank-transfers',                   method: 'GET'  },
];

async function callBosta(c) {
  const url = `${BOSTA_BASE_URL}${c.path}`;
  const init = {
    method: c.method,
    headers: { Authorization: BOSTA_API_KEY, 'Content-Type': 'application/json' },
  };
  if (c.body) init.body = JSON.stringify(c.body);
  const t0 = Date.now();
  try {
    const r = await fetch(url, init);
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { path: c.path, method: c.method, ok: r.ok, status: r.status, ms: Date.now() - t0, body };
  } catch (e) {
    return { path: c.path, method: c.method, ok: false, status: 0, ms: Date.now() - t0, error: e.message };
  }
}

// Best-effort "does this response look wallet-shaped?" heuristic — a body
// that mentions any of these keys is likely to hold transfers/payouts.
const HINT_KEYS = ['transactions', 'transfers', 'payouts', 'invoices', 'cashcycles', 'balance', 'amount', 'walletBalance'];
function looksWalletShaped(body) {
  if (!body || typeof body !== 'object') return false;
  const s = JSON.stringify(body).toLowerCase();
  return HINT_KEYS.some(k => s.includes(k.toLowerCase()));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!BOSTA_API_KEY) return res.status(500).json({ error: 'BOSTA_API_KEY not set' });

  const raw = req.query?.raw === '1' || req.query?.raw === 'true';

  const results = [];
  for (const c of CANDIDATES) {
    results.push(await callBosta(c));
  }

  // Rank: 2xx first, then anything wallet-shaped, then everything else.
  const winners = results
    .filter(r => r.ok && looksWalletShaped(r.body))
    .map(r => ({ path: r.path, method: r.method, status: r.status, ms: r.ms }));

  const summary = results.map(r => ({
    path: r.path,
    method: r.method,
    status: r.status,
    ms: r.ms,
    ok: r.ok,
    wallet_shaped: looksWalletShaped(r.body),
    // Top-level keys give a very compact hint of what the endpoint returned.
    top_keys: (r.body && typeof r.body === 'object' && !Array.isArray(r.body))
      ? Object.keys(r.body).slice(0, 12)
      : (Array.isArray(r.body) ? [`array(${r.body.length})`] : null),
    error: r.error || null,
  }));

  return res.status(200).json({
    tried: CANDIDATES.length,
    winners,
    summary,
    ...(raw ? { raw: results } : {}),
    note: 'Add ?raw=1 to see the full response body of every candidate. The winners[] list shows every endpoint that returned wallet-shaped JSON — paste the first winning path back so we can wire it into the dashboard.',
  });
}
