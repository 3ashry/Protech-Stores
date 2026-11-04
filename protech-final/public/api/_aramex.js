// protech-final/public/api/_aramex.js
// Shared Aramex Shipping API (ShippingAPI.V2, JSON endpoints) helpers.
// Underscore file = helper module, not its own serverless function.
//
// Two environments:
//   live — your account, from Vercel environment variables (never in code):
//          ARAMEX_USERNAME, ARAMEX_PASSWORD, ARAMEX_ACCOUNT_NUMBER, ARAMEX_ACCOUNT_PIN,
//          ARAMEX_ACCOUNT_ENTITY (CAI), ARAMEX_COUNTRY_CODE (EG),
//          ARAMEX_BASE_URL (https://ws.aramex.net/ShippingAPI.V2)
//   test — Aramex's sandbox (fake shipments, no charges, no courier). Uses
//          ARAMEX_TEST_* variables if set, otherwise the public sandbox
//          account Aramex publishes in its developer docs for Egypt (CAI).

const LIVE_KEYS = [
  'ARAMEX_USERNAME', 'ARAMEX_PASSWORD', 'ARAMEX_ACCOUNT_NUMBER', 'ARAMEX_ACCOUNT_PIN',
  'ARAMEX_ACCOUNT_ENTITY', 'ARAMEX_COUNTRY_CODE', 'ARAMEX_BASE_URL',
];

// Aramex's published sandbox account for Egypt — not a secret, test server only.
const PUBLIC_SANDBOX = {
  UserName: 'testingapi@aramex.com',
  Password: 'R123456789$r',
  AccountNumber: '987654',
  AccountPin: '226321',
  AccountEntity: 'CAI',
  AccountCountryCode: 'EG',
  base: 'https://ws.dev.aramex.net/ShippingAPI.V2',
};

const env = (k) => String(process.env[k] || '').trim();
const normMode = (mode) => (mode === 'test' ? 'test' : 'live');

export function aramexBaseUrl(mode = 'live') {
  if (normMode(mode) === 'test') return (env('ARAMEX_TEST_BASE_URL') || PUBLIC_SANDBOX.base).replace(/\/+$/, '');
  return (env('ARAMEX_BASE_URL') || 'https://ws.aramex.net/ShippingAPI.V2').replace(/\/+$/, '');
}

// Which live settings are present (true/false only — never the values).
export function aramexEnvStatus() {
  return Object.fromEntries(LIVE_KEYS.map(k => [k, !!env(k)]));
}

export function aramexConfigured(mode = 'live') {
  if (normMode(mode) === 'test') return true;
  return LIVE_KEYS.slice(0, 4).every(k => !!env(k));
}

export function aramexClientInfo(mode = 'live') {
  if (normMode(mode) === 'test') {
    return {
      UserName: env('ARAMEX_TEST_USERNAME') || PUBLIC_SANDBOX.UserName,
      Password: env('ARAMEX_TEST_PASSWORD') || PUBLIC_SANDBOX.Password,
      Version: 'v1',
      AccountNumber: env('ARAMEX_TEST_ACCOUNT_NUMBER') || PUBLIC_SANDBOX.AccountNumber,
      AccountPin: env('ARAMEX_TEST_ACCOUNT_PIN') || PUBLIC_SANDBOX.AccountPin,
      AccountEntity: PUBLIC_SANDBOX.AccountEntity,
      AccountCountryCode: PUBLIC_SANDBOX.AccountCountryCode,
      Source: 24,
    };
  }
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
// Notifications[], …) or null if it wasn't JSON (raw holds the start of it).
export async function aramexCall(service, method, body = {}, mode = 'live') {
  const url = `${aramexBaseUrl(mode)}/${service}/Service_1_0.svc/json/${method}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ClientInfo: aramexClientInfo(mode), ...body, Transaction: EMPTY_TRANSACTION }),
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  return { httpStatus: r.status, data, raw: data ? null : text.slice(0, 500) };
}

// Aramex reports problems as Notifications [{ Code, Message }] — on the reply
// and, for CreateShipments, on each shipment too.
export function aramexErrors(data) {
  const list = Array.isArray(data && data.Notifications) ? data.Notifications : [];
  return list.map(n => ({ code: n.Code || '', message: n.Message || '' }));
}

// Aramex's WCF JSON date format: "/Date(<ms>+0200)/".
export function aramexDate(ms = Date.now()) {
  return `/Date(${Math.round(ms)}+0200)/`;
}
export function parseAramexDate(v) {
  const m = /Date\((-?\d+)/.exec(String(v || ''));
  return m ? new Date(parseInt(m[1], 10)).toISOString() : null;
}
