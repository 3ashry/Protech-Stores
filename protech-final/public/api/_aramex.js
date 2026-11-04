// protech-final/public/api/_aramex.js
// Shared Aramex Shipping API (ShippingAPI.V2, JSON endpoints) helpers.
// Credentials come only from Vercel environment variables — never from code:
//   ARAMEX_USERNAME, ARAMEX_PASSWORD, ARAMEX_ACCOUNT_NUMBER, ARAMEX_ACCOUNT_PIN,
//   ARAMEX_ACCOUNT_ENTITY (CAI), ARAMEX_COUNTRY_CODE (EG),
//   ARAMEX_BASE_URL (https://ws.aramex.net/ShippingAPI.V2; the test server is
//   https://ws.dev.aramex.net/ShippingAPI.V2).
// Underscore file = helper module, not its own serverless function.

const ENV_KEYS = [
  'ARAMEX_USERNAME', 'ARAMEX_PASSWORD', 'ARAMEX_ACCOUNT_NUMBER', 'ARAMEX_ACCOUNT_PIN',
  'ARAMEX_ACCOUNT_ENTITY', 'ARAMEX_COUNTRY_CODE', 'ARAMEX_BASE_URL',
];

const env = (k) => String(process.env[k] || '').trim();

export function aramexBaseUrl() {
  return (env('ARAMEX_BASE_URL') || 'https://ws.aramex.net/ShippingAPI.V2').replace(/\/+$/, '');
}

// Which settings are present (true/false only — never the values).
export function aramexEnvStatus() {
  return Object.fromEntries(ENV_KEYS.map(k => [k, !!env(k)]));
}

export function aramexConfigured() {
  return ENV_KEYS.slice(0, 4).every(k => !!env(k));
}

function clientInfo() {
  return {
    UserName: env('ARAMEX_USERNAME'),
    Password: env('ARAMEX_PASSWORD'),
    Version: 'v1',
    AccountNumber: env('ARAMEX_ACCOUNT_NUMBER'),
    AccountPin: env('ARAMEX_ACCOUNT_PIN'),
    AccountEntity: env('ARAMEX_ACCOUNT_ENTITY') || 'CAI',
    AccountCountryCode: env('ARAMEX_COUNTRY_CODE') || 'EG',
    Source: 24,
  };
}

const EMPTY_TRANSACTION = { Reference1: '', Reference2: '', Reference3: '', Reference4: '', Reference5: '' };

// POST {base}/{service}/Service_1_0.svc/json/{method}
//   service: 'Location' | 'Shipping' | 'Tracking' | 'RateCalculator'
// Returns { httpStatus, data } — data is Aramex's JSON reply (HasErrors,
// Notifications[], …) or null if it wasn't JSON.
export async function aramexCall(service, method, body = {}) {
  const url = `${aramexBaseUrl()}/${service}/Service_1_0.svc/json/${method}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ClientInfo: clientInfo(), ...body, Transaction: EMPTY_TRANSACTION }),
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  return { httpStatus: r.status, data, raw: data ? null : text.slice(0, 500) };
}

// Aramex reports problems as Notifications [{ Code, Message }].
export function aramexErrors(data) {
  const list = Array.isArray(data && data.Notifications) ? data.Notifications : [];
  return list.map(n => ({ code: n.Code || '', message: n.Message || '' }));
}
