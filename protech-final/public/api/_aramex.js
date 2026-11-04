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

// ─── Governorate → Aramex city + price zone ──────────────────────────────
// City = the governorate's main city as Aramex names it (checked against
// FetchCities once the live login works). Zones are from the Aramex price
// list (E-commerce Domestic, CAI).
const GOV = {
  'القاهرة': ['Cairo', 1], 'القاهره': ['Cairo', 1],
  'الجيزة': ['Giza', 1], 'الجيزه': ['Giza', 1],
  'الإسكندرية': ['Alexandria', 2], 'الاسكندريه': ['Alexandria', 2], 'الإسكندريه': ['Alexandria', 2], 'الاسكندرية': ['Alexandria', 2],
  'بورسعيد': ['Port Said', 2], 'بور سعيد': ['Port Said', 2],
  'الإسماعيلية': ['Ismailia', 2], 'الاسماعيليه': ['Ismailia', 2], 'الإسماعيليه': ['Ismailia', 2], 'الاسماعيلية': ['Ismailia', 2],
  'السويس': ['Suez', 2],
  'القليوبية': ['Banha', 3], 'القليوبيه': ['Banha', 3],
  'المنوفية': ['Shebin El Kom', 3], 'المنوفيه': ['Shebin El Kom', 3],
  'الشرقية': ['Zagazig', 3], 'الشرقيه': ['Zagazig', 3],
  'الغربية': ['Tanta', 3], 'الغربيه': ['Tanta', 3],
  'الدقهلية': ['Mansoura', 3], 'الدقهليه': ['Mansoura', 3],
  'البحيرة': ['Damanhour', 3], 'البحيره': ['Damanhour', 3],
  'دمياط': ['Damietta', 3],
  'كفر الشيخ': ['Kafr El Sheikh', 3],
  'الفيوم': ['Fayoum', 4], 'بني سويف': ['Beni Suef', 4], 'المنيا': ['Minya', 4],
  'أسيوط': ['Assiut', 4], 'اسيوط': ['Assiut', 4], 'سوهاج': ['Sohag', 4],
  'قنا': ['Qena', 5], 'الأقصر': ['Luxor', 5], 'الاقصر': ['Luxor', 5],
  'أسوان': ['Aswan', 5], 'اسوان': ['Aswan', 5],
  'البحر الأحمر': ['Hurghada', 5], 'البحر الاحمر': ['Hurghada', 5],
  'جنوب سيناء': ['Sharm El Sheikh', 5],
  'الساحل الشمالي': ['North Coast', 5],
  'مرسي مطروح': ['Marsa Matrouh', 5], 'مطروح': ['Marsa Matrouh', 5],
  'الوادي الجديد': ['Kharga', 6],
};
export function aramexCityFor(gov) { const g = GOV[String(gov || '').trim()]; return g ? g[0] : null; }
export function aramexZoneFor(gov) { const g = GOV[String(gov || '').trim()]; return g ? g[1] : null; }

// Price list (EGP, before fuel and VAT): [≤5kg, ≤10kg, ≤15kg, ≤25kg, per kg over 25].
const ZONE_RATES = {
  1: [55, 65, 75, 85, 4], 2: [60, 70, 80, 90, 4], 3: [65, 75, 85, 95, 4],
  4: [75, 85, 95, 105, 5], 5: [85, 95, 105, 115, 5], 6: [110, 120, 130, 140, 5],
};
const FUEL_PCT = () => { const v = parseFloat(process.env.ARAMEX_FUEL_PCT); return isFinite(v) ? v : 38; };
const VAT = 0.14;
// "Open the shipment upon delivery" value-added service (SLA CMT 305 CAI):
// 5 EGP per AWB, subject to all surcharges (fuel + VAT). Every order uses it.
const OPEN_FEE = () => { const v = parseFloat(process.env.ARAMEX_OPEN_FEE); return isFinite(v) ? v : 5; };

// Estimated (agreed) charge for one shipment:
//   zone rate by weight (rounded up to whole kg) + 5 EGP open-shipment fee,
//   + fuel surcharge on both, + 0.5% COD fee when the COD is over 4,000,
//   all + 14% VAT.
export function aramexEstimate(gov, weightKg, cod) {
  const zone = aramexZoneFor(gov) || 3;
  const r = ZONE_RATES[zone];
  const w = Math.max(1, Math.ceil(Number(weightKg) || 1));
  const rate = w <= 5 ? r[0] : w <= 10 ? r[1] : w <= 15 ? r[2] : w <= 25 ? r[3] : r[3] + (w - 25) * r[4];
  const openFee = OPEN_FEE();
  const base = rate + openFee;
  const fuel = base * FUEL_PCT() / 100;
  const codFee = (Number(cod) || 0) > 4000 ? (Number(cod) || 0) * 0.005 : 0;
  const total = (base + fuel + codFee) * (1 + VAT);
  return { zone, weight: w, rate, openFee, base, fuel: Math.round(fuel * 100) / 100, codFee: Math.round(codFee * 100) / 100, total: Math.round(total * 100) / 100 };
}

// Shipment weight from the products' Shipping specs: the higher of the
// order's total real weight and its total volumetric weight (total cm³ ÷
// 3000) — the same rule as the checkout price. A product with no specs
// counts as ARAMEX_DEFAULT_KG (1 kg).
export function aramexOrderWeight(lines, productsById) {
  const dflt = parseFloat(process.env.ARAMEX_DEFAULT_KG) || 1;
  let kg = 0, cm3 = 0;
  for (const l of (lines || [])) {
    const p = productsById.get(l && l.id) || {};
    const qty = parseInt(l && l.qty, 10) || 1;
    const w = parseFloat(p.unit_weight_kg) || 0, v = parseFloat(p.unit_volume_cm3) || 0;
    kg += (w || (v ? 0 : dflt)) * qty;
    cm3 += v * qty;
  }
  return Math.round(Math.max(kg, cm3 / 3000, 0.5) * 100) / 100;
}

const emptyAddress = () => ({ Line1: '', Line2: '', Line3: '', City: '', StateOrProvinceCode: '', PostCode: '', CountryCode: '', Longitude: 0, Latitude: 0, BuildingNumber: null, BuildingName: null, Floor: null, Apartment: null, POBox: null, Description: null });
const emptyContact = () => ({ Department: '', PersonName: '', Title: '', CompanyName: '', PhoneNumber1: '', PhoneNumber1Ext: '', PhoneNumber2: '', PhoneNumber2Ext: '', FaxNumber: '', CellPhone: '', EmailAddress: '', Type: '' });
const localPhone = (p) => { let s = String(p || '').replace(/[^\d]/g, ''); if (s.startsWith('20') && s.length === 12) s = '0' + s.slice(2); return s; };
const chunk = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return [t.slice(0, n), t.slice(n, 2 * n), t.slice(2 * n, 3 * n)]; };

// Who/where the parcel is collected from. ARAMEX_SHIPPER_* settings override.
function shipper() {
  return {
    name: env('ARAMEX_SHIPPER_NAME') || 'Protech',
    phone: env('ARAMEX_SHIPPER_PHONE') || '01034482071',
    line1: env('ARAMEX_SHIPPER_ADDRESS') || 'Protech warehouse',
    city: env('ARAMEX_SHIPPER_CITY') || 'Alexandria',
    email: env('ARAMEX_SHIPPER_EMAIL') || 'support@protechstores.com',
  };
}

// Create one COD shipment for an order. Returns
//   { ok, awb, labelUrl, errors[], request } — request is logged on failure.
export async function aramexCreateShipment(order, { weightKg, mode = 'live' } = {}) {
  const ci = aramexClientInfo(mode);
  const s = shipper();
  const city = aramexCityFor(order.city) || String(order.city || '');
  const [l1, l2, l3] = chunk(order.address, 100);
  const consigneeAddr = { ...emptyAddress(), Line1: l1 || '-', Line2: l2, Line3: l3, City: city, CountryCode: 'EG' };
  const consigneeContact = { ...emptyContact(), PersonName: String(order.customer_name || '').slice(0, 45), CompanyName: String(order.customer_name || '').slice(0, 45),
    PhoneNumber1: localPhone(order.phone), PhoneNumber2: localPhone(order.second_phone), CellPhone: localPhone(order.phone) };
  const now = Date.now();
  // SLA: the AWB must say "OPEN THE SHIPMENT UPON DELIVERY" and the special
  // service must be flagged when the shipment is created. Its service code is
  // ARAMEX_OPEN_SERVICE_CODE (added to Services once Aramex confirms it).
  const openNote = 'OPEN THE SHIPMENT UPON DELIVERY - يسمح للعميل بفتح الشحنة ومعاينتها قبل الدفع';
  const services = ['CODS', env('ARAMEX_OPEN_SERVICE_CODE')].filter(Boolean).join(',');
  const shipment = {
    Reference1: String(order.code || order.id), Reference2: String(order.id), Reference3: '',
    Shipper: { Reference1: '', Reference2: '', AccountNumber: ci.AccountNumber,
      PartyAddress: { ...emptyAddress(), Line1: s.line1, City: s.city, CountryCode: 'EG' },
      Contact: { ...emptyContact(), PersonName: s.name, CompanyName: s.name, PhoneNumber1: s.phone, CellPhone: s.phone, EmailAddress: s.email } },
    Consignee: { Reference1: '', Reference2: '', AccountNumber: '', PartyAddress: consigneeAddr, Contact: consigneeContact },
    ThirdParty: { Reference1: '', Reference2: '', AccountNumber: '', PartyAddress: emptyAddress(), Contact: emptyContact() },
    ShippingDateTime: aramexDate(now), DueDate: aramexDate(now + 3 * 86400000),
    Comments: [openNote, order.notes].filter(Boolean).join(' — ').slice(0, 250),
    PickupLocation: '', OperationsInstructions: openNote, AccountingInstrcutions: '',
    Details: {
      Dimensions: null, ActualWeight: { Unit: 'KG', Value: Number(weightKg) || 1 }, ChargeableWeight: null,
      DescriptionOfGoods: 'Tools', GoodsOriginCountry: 'EG', NumberOfPieces: 1,
      ProductGroup: 'DOM', ProductType: env('ARAMEX_PRODUCT_TYPE') || 'OND',
      PaymentType: 'P', PaymentOptions: '', CustomsValueAmount: null,
      CashOnDeliveryAmount: { CurrencyCode: 'EGP', Value: Math.round((parseFloat(order.total) || 0) * 100) / 100 },
      InsuranceAmount: null, CashAdditionalAmount: null, CashAdditionalAmountDescription: '', CollectAmount: null,
      Services: services, Items: [],
    },
    Attachments: [], ForeignHAWB: '', TransportType: 0, PickupGUID: '', Number: null, ScheduledDelivery: null,
  };
  const body = { LabelInfo: { ReportID: 9201, ReportType: 'URL' }, Shipments: [shipment] };
  const r = await aramexCall('Shipping', 'CreateShipments', body, mode);
  const sh = r.data && Array.isArray(r.data.Shipments) ? r.data.Shipments[0] : null;
  const errors = [...aramexErrors(r.data), ...aramexErrors(sh)];
  const awb = sh && sh.ID ? String(sh.ID) : null;
  const ok = !!awb && !(sh && sh.HasErrors);
  return {
    ok, awb, errors, httpStatus: r.httpStatus,
    labelUrl: sh && sh.ShipmentLabel ? (sh.ShipmentLabel.LabelURL || null) : null,
    nonJson: r.raw,
  };
}

// Label URL for an existing shipment.
export async function aramexLabel(awb, mode = 'live') {
  const r = await aramexCall('Shipping', 'PrintLabel', {
    LabelInfo: { ReportID: 9201, ReportType: 'URL' },
    OriginEntity: aramexClientInfo(mode).AccountEntity, ProductGroup: 'DOM', ShipmentNumber: String(awb),
  }, mode);
  const url = r.data && r.data.ShipmentLabel ? r.data.ShipmentLabel.LabelURL : null;
  return { ok: !!url, url, errors: aramexErrors(r.data) };
}

// Tracking history for up to 50 shipments: Map awb → [{code, description,
// at (ISO), location, comments, problem}] newest last.
export async function aramexTrack(awbs, mode = 'live') {
  const out = new Map();
  const r = await aramexCall('Tracking', 'TrackShipments', { Shipments: awbs.map(String), GetLastTrackingUpdateOnly: false }, mode);
  const results = (r.data && r.data.TrackingResults) || [];
  for (const kv of results) {
    const key = String(kv.Key || '');
    const list = (kv.Value || []).map(u => ({
      code: u.UpdateCode || '', description: u.UpdateDescription || '',
      at: parseAramexDate(u.UpdateDateTime), location: u.UpdateLocation || '',
      comments: u.Comments || '', problem: u.ProblemCode || '',
    })).sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    out.set(key, list);
  }
  return { results: out, errors: aramexErrors(r.data), httpStatus: r.httpStatus };
}

// One Aramex tracking update → our order status (null = no change).
// Uses the description text until Aramex sends its code list.
export function aramexStatusOf(u) {
  if (!u) return null;
  const d = `${u.code} ${u.description} ${u.comments}`.toLowerCase();
  if (/(returned|delivered) to (shipper|sender|origin)|rts delivered|return delivered/.test(d)) return 'Returned';
  if (/\breturn|\brts\b/.test(d)) return 'On its way to me';
  if (/out for delivery|with (the )?courier for delivery|on route|out for dlv/.test(d)) return 'Heading to Customer';
  if (u.problem || /attempt|not available|no answer|refus|wrong address|incorrect address|incomplete address|unable to|hold|consignee (not|moved)|closed|reschedul|cancel/.test(d)) return 'Awaiting Action';
  if (/\bdelivered\b|shipment delivered|delivery completed/.test(d)) return 'Delivered';
  if (/picked up|collected|received at|in transit|departed|arrived|processed|forwarded|sorting|transferred|hub/.test(d)) return 'In Transit';
  if (/created|record|data received|manifest/.test(d)) return 'Processing';
  return null;
}

export function aramexTrackingUrl(awb) {
  return `https://www.aramex.com/eg/ar/track/results?ShipmentNumber=${encodeURIComponent(String(awb || ''))}`;
}
