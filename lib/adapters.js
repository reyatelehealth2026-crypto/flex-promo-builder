// Source Adapters — read & normalize product data from Google Sheet (CSV) and JSON
// into a single internal Product schema used by the Flex Builder.
//
// Product = {
//   code, name, imageUrl (required),
//   priceNormal?, priceSale?,
//   promoType: "flash" | "lastlot" | "member" | "custom",
//   badgeText?, badgeColor?, expireText?, stockText?, pointsText?, note?
// }

export const PROMO_TYPES = ['flash', 'lastlot', 'member', 'custom'];

// --- Google Sheet helpers -------------------------------------------------

// Accepts a full Sheet URL or a bare spreadsheet id and returns the gviz CSV
// export endpoint. Throws if no id can be extracted.
export function sheetCsvUrl(input, sheetName) {
  const id = extractSheetId(input);
  if (!id) throw new Error('ไม่พบ Spreadsheet ID จากค่าที่กรอก');
  const base = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv`;
  return sheetName && sheetName.trim()
    ? `${base}&sheet=${encodeURIComponent(sheetName.trim())}`
    : base;
}

function extractSheetId(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s; // looks like a bare id
  return null;
}

// --- CSV parsing ----------------------------------------------------------

// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes,
// and commas / newlines inside quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// --- Normalizers ----------------------------------------------------------

export function normalizeFromCsv(text) {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows
    .slice(1)
    .map((r) => {
      const obj = {};
      header.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
      return toProduct(obj);
    })
    .filter(isUsable);
}

export function normalizeFromJson(input) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  const arr = Array.isArray(data)
    ? data
    : Array.isArray(data?.products)
      ? data.products
      : [data];
  return arr.map(toProduct).filter(isUsable);
}

function isUsable(p) {
  return Boolean(p.code && p.name && p.imageUrl);
}

// Map a raw row/object (snake_case from Sheet, or camelCase from JSON) into a Product.
export function toProduct(raw) {
  const promoRaw = String(pick(raw, 'promoType', 'promo_type') || 'custom')
    .trim()
    .toLowerCase();
  const promoType = PROMO_TYPES.includes(promoRaw) ? promoRaw : 'custom';

  return {
    code: str(pick(raw, 'code')),
    name: str(pick(raw, 'name')),
    imageUrl: str(pick(raw, 'imageUrl', 'image_url', 'image')),
    priceNormal: num(pick(raw, 'priceNormal', 'price_normal')),
    priceSale: num(pick(raw, 'priceSale', 'price_sale')),
    promoType,
    badgeText: opt(pick(raw, 'badgeText', 'badge')),
    badgeColor: opt(pick(raw, 'badgeColor', 'badge_color')),
    expireText: enrichExpire(pick(raw, 'expireText', 'expire')),
    stockText: opt(pick(raw, 'stockText', 'stock')),
    pointsText: enrichPoints(pick(raw, 'pointsText', 'points')),
    note: opt(pick(raw, 'note')),
  };
}

// --- small helpers --------------------------------------------------------

function pick(raw, ...keys) {
  for (const k of keys) {
    const v = raw?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

function str(v) {
  return v === undefined ? '' : String(v).trim();
}

function opt(v) {
  return v === undefined ? undefined : String(v).trim();
}

function num(v) {
  if (v === undefined) return undefined;
  const n = Number(String(v).replace(/[,\s฿]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

// "ถึง 30 มิ.ย." -> "⏰ ถึง 30 มิ.ย." (leave alone if already has a clock/date glyph)
function enrichExpire(v) {
  if (v === undefined) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  return /[⏰🗓📅]/u.test(s) ? s : `⏰ ${s}`;
}

// "70" -> "รับ 70 แต้ม"; otherwise pass the text through unchanged.
function enrichPoints(v) {
  if (v === undefined) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  return /^\d+$/.test(s) ? `รับ ${s} แต้ม` : s;
}
