// Generates prom9_core/tests/data/expected.json from the live lib/ code —
// cross-language parity fixtures for the cny / promo / compositor ports
// (the flex builder + validate are covered by test/golden/fixtures.json).
//
// Regenerate (from the repo root) with:
//   node prom9_core/tools/gen-expected.mjs
// then review the diff before committing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { flattenCnyItem, normalizeFromCny, filterCny, cnyToProduct } from '../../lib/cny.js';
import { extractPromotions, buildPromoProducts } from '../../lib/promo.js';
import { buildBanner, buildOverlay, buildPromoCard } from '../../lib/compositor.js';

// ---- inputs (fixed literals, no Date.now / randomness) ----------------------

export const RAW_CNY_PAGE = {
  product: [
    {
      product_data: [{
        id: 101, sku: 'SKU-101', name: 'ยาดมสมุนไพร', name_en: ' Herbal Inhaler ',
        spec_name: ' หลอด ', is_promotion: 1, is_bestseller: 0, is_recommend: 1,
      }],
      product_price: [{ product_price: [{ price: '120.50', promotion_price: 99 }] }],
      product_photo: [{ photo_path: 'uploads/product_photo/a.jpg' }],
      product_unit: [{ unit: 'หลอด' }],
      product_stock: [{ stock_num: 3 }, { stock_num: '4' }],
      product_is_flashSale: 1,
      customer_buyed: 0,
      is_rx: 0,
    },
    {
      // duplicate productId -> deduped
      product_data: [{ id: 101, sku: 'SKU-101-DUP', name: 'ซ้ำ' }],
      product_price: [{ product_price: [{ price: 50 }] }],
      product_photo: [],
      product_unit: [],
      product_stock: [],
    },
    {
      // no photo -> placeholder; promotion_price >= price -> null; stock > 10
      product_data: [{ id: 102, sku: 'SKU-102', name: 'วิตามินรวม', is_bestseller: 1 }],
      product_price: [{ product_price: [{ price: 731.3299999, promotion_price: 900 }] }],
      product_photo: [],
      product_unit: [{ unit: 'ขวด [30 เม็ด]' }],
      product_stock: [{ stock_num: 99 }],
      customer_buyed: 5,
      is_rx: 1,
    },
    {
      // missing sku -> dropped by flattenCnyPages
      product_data: [{ id: 103, name: 'ไม่มีรหัส' }],
      product_price: [{ product_price: [{ price: 10 }] }],
    },
  ],
  paginate: { total: 4 },
  data_promotion_only: [
    {
      campaign_name: 'แคมเปญเปอร์เซ็นต์',
      data_product: [
        { id: 101, unit: 'หลอด', qty: 3, discount: 10, discount_type: 'percent',
          is_buy_pack: 0, campaign_type: 'normal', campaign_name: 'แคมเปญเปอร์เซ็นต์', end_pro: '2025-03-01' },
      ],
    },
    {
      campaign_name: 'แคมเปญยกแพ็ค',
      data_product: [
        { id: 102, unit: 'ขวด [30 เม็ด]', qty: 6, discount: 12.5, discount_type: 'baht',
          is_buy_pack: 1, campaign_type: 'normal', campaign_name: 'แคมเปญยกแพ็ค' },
        { id: 999, unit: 'ชิ้น', is_giveaway: 1, discount: 0 }, // free item row -> skipped
      ],
    },
    {
      campaign_name: 'ของแถม',
      text: 'ซื้อครบ 500 รับฟรีแก้วน้ำ',
      data_product: [
        { id: 104, unit: 'กล่อง', qty: 1, discount: 0, campaign_type: 'giveaway',
          campaign_name: 'ของแถม', end_pro: null },
      ],
    },
  ],
};

export const SNAPSHOT_FLATS = [
  { sku: 'S1', productId: 1, name: 'สินค้าหนึ่ง', image: 'https://img.test/1.jpg',
    basePrice: 100, promotionPrice: 80, unit: 'กล่อง', stock: 7, tags: ['promotion', 'flash_sale'] },
  { sku: 'S2', productId: 2, name: 'สินค้าสอง', image: 'https://img.test/2.jpg',
    basePrice: '59', promotionPrice: null, unit: '', stock: 0, tags: [] },
  { sku: 'S3', productId: 3, name: 'รูป http', image: 'http://img.test/3.jpg',
    basePrice: 10, promotionPrice: 5, unit: 'ซอง', stock: 2, tags: ['bestseller'] },
  { sku: 'S4', productId: 4, name: 'สินค้าสี่', image: 'https://img.test/4.jpg',
    basePrice: 0, promotionPrice: null, unit: 'ขวด', stock: 10, tags: ['new_arrival'] },
];

// flat catalog records the promo campaigns join onto:
export const PROMO_FLATS = [
  { sku: 'SKU-101', productId: 101, name: 'ยาดมสมุนไพร', image: 'https://img.test/101.jpg',
    basePrice: 120.5, unit: 'หลอด', tags: ['flash_sale'] },
  { sku: 'SKU-102', productId: 102, name: 'วิตามินรวม', image: 'https://img.test/102.jpg',
    basePrice: 731.3299999, unit: 'ขวด [30 เม็ด]', tags: [] },
  { sku: 'SKU-104', productId: 104, name: 'นมผง', image: 'https://img.test/104.jpg',
    basePrice: 500, unit: 'กล่อง', tags: [] },
  { sku: 'SKU-105', productId: 105, name: 'ไม่มีโปร', image: 'https://img.test/105.jpg',
    basePrice: 9, unit: 'ชิ้น', tags: [] },
];

export const BANNER_PRODUCT = {
  code: 'A100', name: 'วิตามินซี 1000 มก. ขนาดบรรจุใหญ่พิเศษ', imageUrl: 'https://img.test/a.jpg',
  priceNormal: 990, priceSale: 731.3299999, promoType: 'flash',
  badgeText: 'ลดแรงส่งท้ายปี', badgeColor: '#0A84FF',
  unitText: 'ขวด [123]', stockText: 'เหลือ 12 ชิ้น', note: 'ซื้อ 2 แถม 1 วันนี้เท่านั้น',
  _promo: { type: 'percent', discount: 26, endsAt: '2025-02-14' },
};

export const BANNER_PRODUCT_MIN = { code: '', name: 'สินค้าไม่มีราคา', imageUrl: '', promoType: 'custom' };

const promoMap = extractPromotions(RAW_CNY_PAGE);

const expected = {
  meta: { note: 'Generated by prom9_core/tools/gen-expected.mjs — do not edit by hand.' },
  cny: {
    flattenedFirstItem: flattenCnyItem(RAW_CNY_PAGE.product[0]),
    normalizeRawPage: normalizeFromCny(RAW_CNY_PAGE),
    normalizeSnapshot: normalizeFromCny({ products: SNAPSHOT_FLATS }),
    normalizeFlatArray: normalizeFromCny(SNAPSHOT_FLATS),
    productStockEdge: [5, 10, 11, 0].map((stock) => cnyToProduct({
      sku: 'S', productId: 9, name: 'n', image: 'https://img.test/s.jpg',
      basePrice: 10, promotionPrice: null, unit: 'ชิ้น', stock, tags: [],
    })),
    filtered: {
      theme: filterCny(normalizeFromCny(SNAPSHOT_FLATS), { theme: 'promotion' }),
      keywords: filterCny(normalizeFromCny(SNAPSHOT_FLATS), { keywords: 'สอง' }),
      both: filterCny(normalizeFromCny(SNAPSHOT_FLATS), { theme: 'new_arrival', keywords: 's4' }),
    },
  },
  promo: {
    promotionKeys: [...promoMap.keys()].sort(),
    products: buildPromoProducts(PROMO_FLATS, promoMap),
  },
  compositor: {
    bannerClassicSquare: buildBanner(BANNER_PRODUCT, {}),
    bannerBoldStory: buildBanner(BANNER_PRODUCT, { size: 'story', template: 'bold' }),
    bannerCnyBranded: buildBanner(BANNER_PRODUCT, {
      size: 'line', template: 'cny', brand: { accent: '#123456' },
    }),
    bannerMinimalProduct: buildBanner(BANNER_PRODUCT_MIN, { size: 'portrait' }),
    bannerPromoDelegates: buildBanner(BANNER_PRODUCT, { template: 'promo', shipFree: false }),
    overlayDefault: buildOverlay(BANNER_PRODUCT, {}),
    overlayCustom: buildOverlay(BANNER_PRODUCT, {
      size: 'story', bgImage: 'https://img.test/scene.jpg', cta: 'ทัก LINE เลย', brand: { primary: '#112233' },
    }),
    overlayPctFromPrices: buildOverlay(
      { ...BANNER_PRODUCT_MIN, priceNormal: 200, priceSale: 150 }, {},
    ),
    promoCardSquare: buildPromoCard(BANNER_PRODUCT, {
      logoUrl: 'https://img.test/logo.png', contact: 'โทร 02-000-0000',
    }),
    promoCardLineNoPriceNoCode: buildPromoCard(
      { code: '', name: 'no price', imageUrl: 'https://img.test/x.jpg', promoType: 'custom' },
      { size: 'line', shipFree: false },
    ),
  },
};

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'data', 'expected.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(expected, null, 2) + '\n');
console.log(`wrote ${out}`);
