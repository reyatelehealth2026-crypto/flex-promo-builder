// CNY catalog adapter — pull products the same way the /update-products cache
// script (refresh-cache.cjs) does: the public CNY API, flattened + classified,
// then mapped into the extension's Product schema.
//
// Sources it understands:
//   - raw API page objects  ({ product: [...], paginate: {...} })   ← live fetch
//   - a cached snapshot      ({ products: [ <flat> ] })             ← cny-products.json
//   - a bare flat[] array

export const CNY_API = 'https://www.cnypharmacy.com/api/getDataProductIsGroup';
const CNY_IMG = 'https://manager.cnypharmacy.com';
const CNY_BASE = 'https://www.cnypharmacy.com';
const PLACEHOLDER = `${CNY_IMG}/uploads/product_photo/placeholder.jpg`;

export function cnyPageUrl(page, paginate = 100) {
  return `${CNY_API}?page=${page}&paginate_num=${paginate}&isPageGroup=`;
}

const toN = (v) => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Port of refresh-cache.cjs flatten(): one raw API item -> flat record + tags.
export function flattenCnyItem(it) {
  const d = it.product_data?.[0] || {};
  const pi = it.product_price?.[0]?.product_price?.[0] || {};
  const photo = it.product_photo?.[0]?.photo_path || null;
  const unit = it.product_unit?.[0]?.unit || '';
  const basePrice = toN(pi.price);
  const promoRaw = toN(pi.promotion_price);
  const promotionPrice = promoRaw > 0 && promoRaw < basePrice ? promoRaw : null;
  const stock = (it.product_stock || []).reduce((s, x) => s + toN(x.stock_num), 0);

  const tags = [];
  if (d.is_promotion === 1) tags.push('promotion');
  if (it.product_is_flashSale === 1) tags.push('flash_sale');
  if (d.is_bestseller === 1 || (it.customer_buyed ?? 0) > 0) tags.push('bestseller');
  if (d.is_recommend === 1 || it.product_is_recommend === 1) tags.push('new_arrival');

  return {
    sku: d.sku || '',
    productId: d.id || null,
    name: d.name || '',
    nameEn: (d.name_en || '').trim(),
    specName: (d.spec_name || '').trim(),
    image: photo ? `${CNY_IMG}/${photo}` : PLACEHOLDER,
    url: d.sku ? `${CNY_BASE}/product/${d.sku}` : CNY_BASE,
    basePrice,
    promotionPrice,
    unit,
    stock,
    isPrescription: it.is_rx === 1,
    tags,
  };
}

// raw API pages (page objects or item arrays) -> deduped flat[] (by productId).
export function flattenCnyPages(pages) {
  const seen = new Set();
  const out = [];
  for (const page of pages) {
    const items = Array.isArray(page) ? page : (page?.product || []);
    for (const it of items) {
      const flat = flattenCnyItem(it);
      if (!flat.sku || !flat.productId || seen.has(flat.productId)) continue;
      seen.add(flat.productId);
      out.push(flat);
    }
  }
  return out;
}

// flat record -> extension Product. Sale items default to the "flash" preset;
// tags are kept on `_tags` for client-side theme filtering (builder ignores it).
export function cnyToProduct(flat) {
  const basePrice = toN(flat.basePrice);
  const promo = flat.promotionPrice;
  const priceNormal = basePrice > 0 ? basePrice : undefined;
  const priceSale = promo != null && toN(promo) > 0 ? toN(promo) : undefined;
  const stock = toN(flat.stock);

  return {
    code: String(flat.sku || '').trim(),
    name: String(flat.name || '').trim(),
    imageUrl: String(flat.image || '').trim(),
    priceNormal,
    priceSale,
    promoType: priceSale != null ? 'flash' : 'custom',
    stockText: stock > 0 && stock <= 10 ? `🔥 เหลือ ${stock} ชิ้น` : undefined,
    unitText: String(flat.unit || '').trim(),
    _tags: Array.isArray(flat.tags) ? flat.tags : [],
  };
}

// Accepts raw API page(s), a cached snapshot, or a flat[] array.
export function normalizeFromCny(input) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  let flats;
  if (Array.isArray(data) && data[0]?.product_data) {
    flats = flattenCnyPages([data]);          // array of raw API items
  } else if (data?.product) {
    flats = flattenCnyPages([data]);          // single raw API page object
  } else {
    flats = Array.isArray(data) ? data : (data?.products || []); // pre-flattened snapshot
  }
  return flats
    .map(cnyToProduct)
    .filter((p) => p.code && p.name && /^https:\/\//i.test(p.imageUrl));
}

// Heuristic: does this parsed JSON look like CNY data (vs an extension Product array)?
export function isCnyPayload(data) {
  const probe = Array.isArray(data)
    ? data[0]
    : (data?.products?.[0] ?? data?.product?.[0] ?? data);
  if (!probe || typeof probe !== 'object') return false;
  return (
    probe.product_data !== undefined ||
    (probe.sku !== undefined && (probe.basePrice !== undefined || probe.tags !== undefined))
  );
}

const THEMES = ['promotion', 'flash_sale', 'bestseller', 'new_arrival'];

export function filterCny(products, { theme, keywords } = {}) {
  let out = products;
  if (theme && THEMES.includes(theme)) {
    out = out.filter((p) => (p._tags || []).includes(theme));
  }
  if (keywords) {
    const k = keywords.toLowerCase();
    out = out.filter((p) => p.code.toLowerCase().includes(k) || p.name.toLowerCase().includes(k));
  }
  return out;
}
