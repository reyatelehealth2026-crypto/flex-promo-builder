// Unit tests for sidepanel/state.js — the selectors take an explicit state
// literal here, the same functions panel.js calls with the shared default.

import test from 'node:test';
import assert from 'node:assert/strict';
import { state, PER_PAGE, presetOptions, visibleProducts, expiryTs, pageProducts, discountPct } from '../sidepanel/state.js';

const P = (over = {}) => ({
  code: 'A100', name: 'วิตามินซี', imageUrl: 'https://x/p.jpg',
  priceNormal: 100, priceSale: 80, promoType: 'flash', ...over,
});

const S = (over = {}) => ({
  ...state, products: [], search: '', pFilter: 'all', sortBy: '', page: 1, customPresets: [], ...over,
});

test('visibleProducts filters by search on code and name', () => {
  const s = S({ products: [P(), P({ code: 'B200', name: 'เจลล้างมือ' })], search: 'เจล' });
  assert.deepStrictEqual(visibleProducts(s).map((p) => p.code), ['B200']);
  s.search = 'a1';
  assert.deepStrictEqual(visibleProducts(s).map((p) => p.code), ['A100']);
});

test('visibleProducts pFilter discount/giveaway', () => {
  const discount = P({ _promo: { type: 'percent' } });
  const giveaway = P({ code: 'G1', _promo: { type: 'giveaway' } });
  const noteGive = P({ code: 'G2', priceSale: null, note: 'ซื้อ 2 แถม 1' });
  const s = S({ products: [discount, giveaway, noteGive] });
  s.pFilter = 'discount';
  assert.deepStrictEqual(visibleProducts(s).map((p) => p.code), ['A100']);
  s.pFilter = 'giveaway';
  assert.deepStrictEqual(visibleProducts(s).map((p) => p.code), ['G1', 'G2']);
});

test('visibleProducts sorts by discount and expiry', () => {
  const small = P({ code: 'S', priceSale: 90 });          // 10%
  const big = P({ code: 'B', priceSale: 50 });            // 50%
  const s = S({ products: [small, big], sortBy: 'discount' });
  assert.deepStrictEqual(visibleProducts(s).map((p) => p.code), ['B', 'S']);

  const late = P({ code: 'L', _promo: { endsAt: '2030-12-31' } });
  const soon = P({ code: 'E', _promo: { endsAt: '2030-01-01' } });
  const never = P({ code: 'N' });
  const s2 = S({ products: [late, never, soon], sortBy: 'expiry' });
  assert.deepStrictEqual(visibleProducts(s2).map((p) => p.code), ['E', 'L', 'N']);
});

test('pageProducts slices and clamps the page', () => {
  const products = Array.from({ length: PER_PAGE + 5 }, (_, i) => P({ code: `P${i}` }));
  const s = S({ products, page: 2 });
  assert.equal(pageProducts(s).length, 5);
  s.page = 99;
  pageProducts(s);
  assert.equal(s.page, 2); // clamped to the last page
});

test('discountPct prefers explicit percent promo, else derives, else 0', () => {
  assert.equal(discountPct(P({ _promo: { type: 'percent', discount: 26.4 } })), 26);
  assert.equal(discountPct(P({ priceNormal: 200, priceSale: 150 })), 25);
  assert.equal(discountPct(P({ priceSale: null })), 0);
  assert.equal(discountPct(P({ priceNormal: 100, priceSale: 150 })), 0); // inverted
});

test('expiryTs parses endsAt and rejects garbage', () => {
  assert.equal(expiryTs(P()), null);
  assert.equal(expiryTs(P({ _promo: { endsAt: 'ไม่ใช่วันที่' } })), null);
  assert.equal(typeof expiryTs(P({ _promo: { endsAt: '2030-01-01' } })), 'number');
});

test('presetOptions appends custom presets to the base four', () => {
  assert.equal(presetOptions(S()).length, 4);
  const s = S({ customPresets: [{ id: 'c_1', label: 'โปรฉัน' }] });
  assert.deepStrictEqual(presetOptions(s)[4], ['c_1', 'โปรฉัน']);
});
