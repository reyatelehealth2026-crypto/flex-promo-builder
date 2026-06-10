# MASTER CONTEXT — Flex Promo Builder upgrade sprint

Project root: `C:/Users/Administrator/Desktop/ex/flex-promo-builder`

## Architecture (read this first)
- **Electron desktop app.** Renderer = `sidepanel/panel.html` + `panel.js` (ES modules, imports `../lib/*`). Main process = `desktop/main.js` (CJS). Preload = `desktop/preload.js` (chrome.* shim + `window.cardRender`).
- **Card renderer** = `desktop/card-renderer.cjs`: `renderCard(record, opts) -> Promise<PNG dataURL>`. Fills HTML templates in `assets/cards/templates/` (A=white product card, B=themed poster w/ bg, C=GWP) with record values, inlines fonts/logo as data URIs, captures via ONE shared offscreen BrowserWindow (never create/destroy per render — GPU crash), zoom-fits the fixed layout into the screen-clamped capture surface (`targetPx()`), serialized via promise chain.
- **IPC**: `render-card`, `fetch` (proxy), `store-get/set`, `open-external`.
- Templates use CSS vars from `assets/cards/tokens.css` (`--canvas: 1080px`, brand colors `--cny-red/-blue/-yellow/-green`, fonts Prompt/Sarabun via `{{FONT_DIR}}` replaced at render).

## Product schema (renderer side)
```js
{ code, name, imageUrl, priceNormal, priceSale, badgeText, badgeColor, note, unitText,
  _promo: { qty, unit, discount, type:'percent'|'baht'|'giveaway', isBuyPack, campaignName, endsAt } }
```
Card record (template A/B): `{ name, sku, photo(dataURI), price_normal, price_special, save, pack_unit, pack_text }`
Flex builder: `lib/flex-builder.js` — `buildBubble(product)`, `buildCarousels(products, {template})`, templates today: `classic`, `promo`.

## Sprint goals (user feedback, 6 items → 5 jobs)
1. Cards must include product photo + full promo info at ALL sizes (square 1080², portrait 1080×1350, story 1080×1920, line 1040²); auto background-cutout of white product shots.
2. Prompt builder: checkbox/chip-driven prompt composer (purpose/style/theme/elements), marketing-designed option set, shared by all gen features.
3. AI image gen split into clear modes: product-image (ref-based; Ads/poster/product-info/drug-info) vs background-only; clear-results buttons.
4. More Flex card templates (big-price, minimal, urgent, gwp); AI chat = converse first (grill-me style) then apply.
5. Flexible custom presets; catalog filter reduced to โปรโม/ของแถม; chat opens in a SEPARATE BrowserWindow (perf).

## Rules
- Surgical edits; match existing style (Thai UI strings, comment style). No new deps. Files < 500 lines where possible.
- Each agent touches ONLY its assigned files (listed in its prompt). The lead integrates `sidepanel/panel.js/html/css` afterwards — do NOT edit those unless told.
- Verify: `node --check <file.cjs>` / `node --input-type=module --check < file.js`. Pure modules: include a tiny self-test runnable with plain node.
- Report back: what changed, public API signatures, anything the lead must wire in panel.js.
