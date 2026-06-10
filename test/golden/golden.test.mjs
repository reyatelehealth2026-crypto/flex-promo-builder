// Golden tests: rebuild every case from cases.mjs and compare against the
// committed fixtures.json. A failure means lib/ output changed — if the
// change is intentional, run `npm run fixtures` and review the diff.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll } from './cases.mjs';
import { buildCarousel, MAX_BUBBLES } from '../../lib/flex-builder.js';

const fixturesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures.json');
const golden = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const rebuilt = buildAll();

for (const key of Object.keys(golden.cases)) {
  test(`golden: ${key}`, () => {
    assert.deepStrictEqual(rebuilt.cases[key], golden.cases[key]);
  });
}

test('no extra case groups beyond the fixtures', () => {
  assert.deepStrictEqual(Object.keys(rebuilt.cases), Object.keys(golden.cases));
});

test(`buildCarousel throws above ${MAX_BUBBLES} bubbles`, () => {
  const thirteen = Array.from({ length: 13 }, (_, i) => ({
    code: `X${i}`, name: `x${i}`, imageUrl: 'https://example.com/p.jpg', priceNormal: 1, promoType: 'flash',
  }));
  assert.throws(() => buildCarousel(thirteen), /13/);
});

test('buildAll is deterministic', () => {
  assert.equal(JSON.stringify(buildAll()), JSON.stringify(buildAll()));
});
