// UI state + pure selectors for the side panel — no DOM access here.
// panel.js mutates the shared `state` object; the selectors default to it
// so existing call sites stay `visibleProducts()` etc., while tests can
// pass an explicit state literal.

import { defaultSelection } from '../lib/promptkit.js';

export const BASE_PRESETS = [
  ['flash', '⚡ Flash Sale'],
  ['lastlot', '🔥 ล็อตสุดท้าย'],
  ['member', '💎 ราคาสมาชิก'],
  ['custom', 'กำหนดเอง'],
];
export const PER_PAGE = 60;  // rendering 6k cards at once freezes the DOM

export const state = {
  // user-defined presets ({id,label,badgeText,badgeColor}) live alongside BASE_PRESETS
  customPresets: [],
  products: [],
  presetByCode: new Map(),
  selectedCodes: new Set(),
  search: '',
  viewMode: 'grid',
  page: 1,                 // product-list pagination
  sortBy: '',              // '' | 'discount' | 'expiry'
  pFilter: 'all',          // 'all' | 'discount' | 'giveaway' — promo-type chips above the list
  genMode: 'product',      // AI image gen mode: 'product' (ref-based) | 'bg' (scene only)
  kitSel: { product: defaultSelection('product'), bg: defaultSelection('bg') },
  aiOverride: null,        // when set, preview/export use this AI-edited flex payload
  lastSourceLabel: '',     // for the cache hint (e.g. "โปรโมชัน")
  chatMode: 'advise',      // 'advise' (suggest then apply) | 'apply' (edit now)
  refImage: null,          // { mime, base64 } reference image for AI image gen (image-to-image)
  promoLogo: null,         // data URL of the shop logo for the SPECIAL PROMO card
};

export const presetOptions = (s = state) =>
  [...BASE_PRESETS, ...s.customPresets.map((c) => [c.id, c.label])];

export function visibleProducts(s = state) {
  let list = !s.search ? s.products : s.products.filter((p) =>
    p.code.toLowerCase().includes(s.search) || p.name.toLowerCase().includes(s.search));
  if (s.pFilter === 'discount') {
    list = list.filter((p) => p._promo && p._promo.type !== 'giveaway' && p.priceSale != null);
  } else if (s.pFilter === 'giveaway') {
    list = list.filter((p) => (p._promo && p._promo.type === 'giveaway') || /แถม/.test(p.note || ''));
  }
  if (s.sortBy === 'discount') {
    list = [...list].sort((a, b) => discountPct(b) - discountPct(a));
  } else if (s.sortBy === 'expiry') {
    list = [...list].sort((a, b) => (expiryTs(a) ?? Infinity) - (expiryTs(b) ?? Infinity));
  }
  return list;
}

// Campaign end (`end_pro`) as a timestamp, or null when the promo has no expiry.
export function expiryTs(p) {
  const raw = p._promo && p._promo.endsAt;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

// Hard Rule 5: surface expiring/expired promos before they get rendered.
export function expiryInfo(p) {
  const t = expiryTs(p);
  if (t == null) return null;
  const days = Math.floor((t - Date.now()) / 86400000);
  if (days < 0) return { expired: true, label: '⏰ โปรหมดอายุ' };
  if (days <= 3) return { expired: false, label: days === 0 ? '⏰ หมดวันนี้' : `⏰ เหลือ ${days} วัน` };
  return null;
}

// The slice of the filtered list shown on the current page (clamps s.page).
export function pageProducts(s = state) {
  const list = visibleProducts(s);
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  if (s.page > pages) s.page = pages;
  return list.slice((s.page - 1) * PER_PAGE, s.page * PER_PAGE);
}

// Discount percent for the corner chip — from explicit percent promos when
// available, else derived from normal vs sale price. Returns 0 when N/A.
export function discountPct(p) {
  if (p._promo && p._promo.type === 'percent' && p._promo.discount > 0) {
    return Math.round(p._promo.discount);
  }
  if (p.priceSale != null && p.priceNormal > 0 && p.priceSale < p.priceNormal) {
    return Math.round((1 - p.priceSale / p.priceNormal) * 100);
  }
  return 0;
}
