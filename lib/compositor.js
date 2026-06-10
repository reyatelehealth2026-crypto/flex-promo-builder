// Compositor — computes a "draw plan" for a promo banner that a <canvas>
// renderer later executes. This module does NO drawing itself: it is a pure
// ES module with no DOM, no Electron, and no external imports, so it runs the
// same under plain Node, Electron, or a bundler.
//
// Public API:
//   SIZES                       -> canvas dimensions per size key
//   money(n)                    -> human-formatted price string
//   buildBanner(product, opts)  -> { width, height, background, elements }
//
// The renderer understands these element ops (all coordinates are absolute
// pixels inside the [0,width] x [0,height] box):
//   { type:'rect',  x,y,w,h, fill, radius? }
//   { type:'image', src, x,y,w,h, fit:'cover'|'contain' }
//   { type:'text',  text, x,y, size, color, weight, align, strike?, maxWidth? }

export const SIZES = {
  square:   [1080, 1080],
  portrait: [1080, 1350],
  story:    [1080, 1920],
  line:     [1040, 1040],
};

// Festive brand presets selectable as a "template" (colors only — layout stays
// the bold full-bleed header so the change is low-risk).
const TEMPLATE_BRANDS = {
  cny: { primary: '#C8102E', accent: '#F4C430', ink: '#7A1416', bg: '#FFF7E6' },
};

const DEFAULT_BRAND = {
  primary: '#E8000D',
  accent:  '#27AE60',
  ink:     '#222222',
  bg:      '#FFFFFF',
};

// ---------------------------------------------------------------------------
// money(n): thousand-separated, drops a trailing ".00", and tames binary
// float error (731.3299999 -> "731.33", 1200 -> "1,200", 1234.5 -> "1,234.50").
// ---------------------------------------------------------------------------
export function money(n) {
  const num = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(num)) return '0';

  // Round to 2 decimals via integer cents to kill float drift, e.g.
  // 731.3299999 -> 73133 cents -> 731.33.
  const cents = Math.round((num + Number.EPSILON) * 100);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);

  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;

  // Group the integer part with thousands separators without relying on locale.
  const groupedWhole = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  if (frac === 0) return sign + groupedWhole;

  const fracStr = String(frac).padStart(2, '0');
  return sign + groupedWhole + '.' + fracStr;
}

// ---------------------------------------------------------------------------
// Small layout helpers — keep everything inside the canvas box.
// ---------------------------------------------------------------------------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Rough word-wrap: estimates how many lines a string needs at a given font
// size and max width, so we can advance the cursor without measuring glyphs.
// The renderer does the real wrapping via maxWidth; this is only for layout
// flow. Returns the number of lines (>=1).
function estimateLines(text, size, maxWidth) {
  if (!text || !maxWidth) return 1;
  // Average glyph advance ~0.55em is a safe, font-agnostic guess.
  const charsPerLine = Math.max(1, Math.floor(maxWidth / (size * 0.55)));
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

// ---------------------------------------------------------------------------
// buildBanner(product, opts) -> draw plan
// ---------------------------------------------------------------------------
export function buildBanner(product = {}, opts = {}) {
  // The cnypharmacy "SPECIAL PROMO" card is its own full layout.
  if (opts.template === 'promo') return buildPromoCard(product, opts);

  const sizeKey = SIZES[opts.size] ? opts.size : 'square';
  const [width, height] = SIZES[sizeKey];

  const isFestive = !!TEMPLATE_BRANDS[opts.template];
  const template = (opts.template === 'bold' || isFestive) ? 'bold' : 'classic';
  const brand = { ...DEFAULT_BRAND, ...(isFestive ? TEMPLATE_BRANDS[opts.template] : {}), ...(opts.brand || {}) };

  const PAD = 48;
  const innerW = width - PAD * 2;

  const elements = [];
  const push = (el) => {
    // Final safety net: clamp every element's origin into the canvas box so
    // the contract "x in [0,width], y in [0,height]" always holds.
    el.x = clamp(el.x, 0, width);
    el.y = clamp(el.y, 0, height);
    elements.push(el);
    return el;
  };

  // 1) Background fill.
  push({ type: 'rect', x: 0, y: 0, w: width, h: height, fill: brand.bg });

  // ----- Image region (top ~58%) -------------------------------------------
  const imageRegionH = Math.round(height * 0.58);

  if (template === 'bold') {
    // Bold: full-bleed colored header behind the product image.
    push({ type: 'rect', x: 0, y: 0, w: width, h: imageRegionH, fill: brand.primary });
  } else {
    // Classic: a light card rect that the product image sits on.
    push({
      type: 'rect',
      x: PAD,
      y: PAD,
      w: innerW,
      h: imageRegionH - PAD,
      fill: '#F4F4F4',
      radius: 24,
    });
  }

  // Product image, fit:'contain', inset inside the region.
  const imgInset = template === 'bold' ? 64 : PAD + 24;
  const imgX = imgInset;
  const imgY = template === 'bold' ? 48 : PAD + 24;
  const imgW = width - imgInset * 2;
  const imgH = imageRegionH - imgY - 24;
  push({
    type: 'image',
    src: product.imageUrl,
    x: imgX,
    y: imgY,
    w: Math.max(0, imgW),
    h: Math.max(0, imgH),
    fit: 'contain',
  });

  // ----- SPECIAL-OFFER badge (filled, primary, white bold text) -------------
  const badgeText = product.badgeText || 'SPECIAL OFFER';
  const badgeColor = product.badgeColor || brand.primary;
  const badgeH = 64;
  const badgeY = PAD;
  // Width scales loosely with text length; capped to the inner width.
  const badgeW = clamp(Math.round(badgeText.length * 22 + 56), 180, innerW);
  const badgeX = PAD;
  push({ type: 'rect', x: badgeX, y: badgeY, w: badgeW, h: badgeH, fill: badgeColor, radius: 12 });
  push({
    type: 'text',
    text: badgeText,
    x: badgeX + badgeW / 2,
    y: badgeY + badgeH / 2,
    size: 30,
    color: '#FFFFFF',
    weight: 'bold',
    align: 'center',
    maxWidth: badgeW - 24,
  });

  // ----- Text block (below the image region) -------------------------------
  let cursorY = imageRegionH + PAD;

  // Product name (bold, ink, wraps via maxWidth).
  const nameSize = template === 'bold' ? 56 : 50;
  const name = product.name || '';
  push({
    type: 'text',
    text: name,
    x: PAD,
    y: cursorY,
    size: nameSize,
    color: brand.ink,
    weight: 'bold',
    align: 'left',
    maxWidth: innerW,
  });
  cursorY += estimateLines(name, nameSize, innerW) * (nameSize + 12) + 16;

  // ----- Price block --------------------------------------------------------
  const hasNormal = typeof product.priceNormal === 'number' && Number.isFinite(product.priceNormal);
  const hasSale = typeof product.priceSale === 'number' && Number.isFinite(product.priceSale);
  const saleSize = template === 'bold' ? 96 : 76;

  if (hasNormal && hasSale) {
    // Normal (small grey, struck through).
    const normalSize = 34;
    push({
      type: 'text',
      text: 'ราคาปกติ ฿' + money(product.priceNormal),
      x: PAD,
      y: cursorY,
      size: normalSize,
      color: '#999999',
      weight: 'normal',
      align: 'left',
      strike: true,
      maxWidth: innerW,
    });
    cursorY += normalSize + 14;

    // Sale (large, bold, primary).
    push({
      type: 'text',
      text: '฿' + money(product.priceSale),
      x: PAD,
      y: cursorY,
      size: saleSize,
      color: brand.primary,
      weight: 'bold',
      align: 'left',
      maxWidth: innerW,
    });
    cursorY += saleSize + 12;

    // Savings (accent).
    const save = product.priceNormal - product.priceSale;
    if (save > 0) {
      const saveSize = 36;
      push({
        type: 'text',
        text: 'ประหยัด ฿' + money(save),
        x: PAD,
        y: cursorY,
        size: saveSize,
        color: brand.accent,
        weight: 'bold',
        align: 'left',
        maxWidth: innerW,
      });
      cursorY += saveSize + 12;
    }
  } else if (hasSale || hasNormal) {
    // Single price line.
    const single = hasSale ? product.priceSale : product.priceNormal;
    push({
      type: 'text',
      text: '฿' + money(single),
      x: PAD,
      y: cursorY,
      size: saleSize,
      color: brand.primary,
      weight: 'bold',
      align: 'left',
      maxWidth: innerW,
    });
    cursorY += saleSize + 12;
  }

  // Optional unit / stock supporting lines.
  for (const extra of [product.unitText, product.stockText]) {
    if (extra) {
      push({
        type: 'text',
        text: extra,
        x: PAD,
        y: cursorY,
        size: 30,
        color: '#666666',
        weight: 'normal',
        align: 'left',
        maxWidth: innerW,
      });
      cursorY += 30 + 10;
    }
  }

  // ----- Bottom brand bar (reserve space first) -----------------------------
  const barH = 84;
  const barY = height - barH;

  // ----- Promo condition (product.note), small, above the brand bar --------
  if (product.note) {
    const noteSize = 30;
    const noteLines = estimateLines(product.note, noteSize, innerW);
    const noteBlockH = noteLines * (noteSize + 8);
    // Place it so it never collides with the brand bar.
    const noteY = clamp(cursorY, cursorY, barY - noteBlockH - 12);
    push({
      type: 'text',
      text: product.note,
      x: PAD,
      y: noteY,
      size: noteSize,
      color: '#777777',
      weight: 'normal',
      align: 'left',
      maxWidth: innerW,
    });
  }

  // Brand bar rect + white code text.
  push({ type: 'rect', x: 0, y: barY, w: width, h: barH, fill: brand.primary });
  push({
    type: 'text',
    text: 'รหัส ' + (product.code || ''),
    x: width / 2,
    y: barY + barH / 2,
    size: 34,
    color: '#FFFFFF',
    weight: 'bold',
    align: 'center',
    maxWidth: innerW,
  });

  return {
    width,
    height,
    background: brand.bg,
    elements,
  };
}

// ---------------------------------------------------------------------------
// pctOff(product): discount percent for the corner chip. Mirrors the panel's
// discountPct but kept local so this module stays import-free.
// ---------------------------------------------------------------------------
function pctOff(p) {
  if (p && p._promo && p._promo.type === 'percent' && p._promo.discount > 0) {
    return Math.round(p._promo.discount);
  }
  if (Number.isFinite(p.priceSale) && p.priceNormal > 0 && p.priceSale < p.priceNormal) {
    return Math.round((1 - p.priceSale / p.priceNormal) * 100);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// buildOverlay(product, opts) -> draw plan
// Lays crisp promo TEXT (badge / price / CTA) over a full-bleed background
// image — typically an AI-generated scene (opts.bgImage, a data: or http URL).
// This turns a "pretty picture" into a sellable ad without relying on the AI
// to render Thai text (which it mangles). opts: { size, bgImage, brand, cta }.
// ---------------------------------------------------------------------------
export function buildOverlay(product = {}, opts = {}) {
  const sizeKey = SIZES[opts.size] ? opts.size : 'square';
  const [width, height] = SIZES[sizeKey];
  const brand = { ...DEFAULT_BRAND, ...(opts.brand || {}) };
  const PAD = 48;
  const innerW = width - PAD * 2;
  const elements = [];

  // 1) Full-bleed background image (AI scene / product photo), cropped to fill.
  elements.push({
    type: 'image',
    src: opts.bgImage || product.imageUrl,
    x: 0, y: 0, w: width, h: height,
    fit: 'cover',
  });

  // 2) SPECIAL-OFFER badge (top-left).
  const badgeText = product.badgeText || 'SPECIAL OFFER';
  const badgeColor = product.badgeColor || brand.primary;
  const badgeH = 64;
  const badgeW = clamp(Math.round(badgeText.length * 22 + 56), 180, innerW);
  elements.push({ type: 'rect', x: PAD, y: PAD, w: badgeW, h: badgeH, fill: badgeColor, radius: 12 });
  elements.push({
    type: 'text', text: badgeText, x: PAD + badgeW / 2, y: PAD + badgeH / 2,
    size: 30, color: '#FFFFFF', weight: 'bold', align: 'center', maxWidth: badgeW - 24,
  });

  // 3) Discount chip (top-right).
  const pct = pctOff(product);
  if (pct) {
    const chipW = 156, chipH = 64;
    elements.push({ type: 'rect', x: width - PAD - chipW, y: PAD, w: chipW, h: chipH, fill: brand.primary, radius: 12 });
    elements.push({
      type: 'text', text: `ลด ${pct}%`, x: width - PAD - chipW / 2, y: PAD + chipH / 2,
      size: 36, color: '#FFFFFF', weight: 'bold', align: 'center', maxWidth: chipW - 16,
    });
  }

  // 4) Bottom scrim (semi-transparent) for text legibility.
  const barH = Math.round(height * 0.36);
  const barY = height - barH;
  elements.push({ type: 'rect', x: 0, y: barY, w: width, h: barH, fill: 'rgba(0,0,0,0.55)' });

  // 5) Text stack inside the scrim.
  let cy = barY + 28;
  const name = product.name || '';
  const nameSize = 46;
  elements.push({
    type: 'text', text: name, x: PAD, y: cy, size: nameSize,
    color: '#FFFFFF', weight: 'bold', align: 'left', maxWidth: innerW,
  });
  cy += estimateLines(name, nameSize, innerW) * (nameSize + 10) + 12;

  const hasNormal = Number.isFinite(product.priceNormal);
  const hasSale = Number.isFinite(product.priceSale);
  if (hasNormal && hasSale) {
    elements.push({
      type: 'text', text: 'ราคาปกติ ฿' + money(product.priceNormal), x: PAD, y: cy,
      size: 32, color: '#DDDDDD', weight: 'normal', align: 'left', strike: true, maxWidth: innerW,
    });
    cy += 32 + 12;
    elements.push({
      type: 'text', text: '฿' + money(product.priceSale), x: PAD, y: cy,
      size: 88, color: '#FFD60A', weight: 'bold', align: 'left', maxWidth: innerW,
    });
    cy += 88 + 8;
  } else if (hasSale || hasNormal) {
    const single = hasSale ? product.priceSale : product.priceNormal;
    elements.push({
      type: 'text', text: '฿' + money(single), x: PAD, y: cy,
      size: 88, color: '#FFD60A', weight: 'bold', align: 'left', maxWidth: innerW,
    });
    cy += 88 + 8;
  }

  // 6) CTA (bottom strip).
  const cta = opts.cta || 'สั่งเลย • ทักแชทร้าน';
  elements.push({
    type: 'text', text: cta, x: PAD, y: height - 40,
    size: 30, color: '#FFFFFF', weight: 'bold', align: 'left', maxWidth: innerW,
  });

  return { width, height, background: brand.bg, elements };
}

// ---------------------------------------------------------------------------
// buildPromoCard(product, opts) -> draw plan
// Replicates the cnypharmacy "SPECIAL PROMO" card: gold background, red promo
// seal, real product photo on a white panel, code tag, "จำนวนจำกัด", a white
// price box with red border ("กระปุกละ NNN.-"), and a bottom info/ส่งฟรี strip.
// Uses the REAL product image — no AI. opts: { size, logoUrl, contact, shipFree }.
// ---------------------------------------------------------------------------
export function buildPromoCard(product = {}, opts = {}) {
  const sizeKey = SIZES[opts.size] ? opts.size : 'square';
  const [W, H] = SIZES[sizeKey];

  const GOLD = '#FFC400';
  const RED = '#E2001A';
  const INK = '#1A1A1A';
  const WHITE = '#FFFFFF';
  const els = [];
  const P = Math.round(W * 0.026);            // outer gold frame
  const innerX = P;
  const innerW = W - P * 2;

  // Background gold.
  els.push({ type: 'rect', x: 0, y: 0, w: W, h: H, fill: GOLD });

  // ----- top row: SPECIAL PROMO starburst seal (left) + logo (right) ---------
  const topH = Math.round(H * 0.115);
  const sealR = Math.round(topH * 0.74);
  const cx = innerX + 10 + sealR;
  const cy = P + sealR;
  els.push({ type: 'burst', cx, cy, rOuter: sealR, rInner: Math.round(sealR * 0.80), points: 14, fill: RED });
  els.push({
    type: 'text', text: 'SPECIAL', x: cx, y: cy - sealR * 0.24,
    size: Math.round(sealR * 0.34), color: '#FFE000', weight: 'bold', align: 'center', maxWidth: sealR * 1.7,
  });
  els.push({
    type: 'text', text: 'PROMO', x: cx, y: cy + sealR * 0.24,
    size: Math.round(sealR * 0.34), color: WHITE, weight: 'bold', align: 'center', maxWidth: sealR * 1.7,
  });
  if (opts.logoUrl) {
    const lw = Math.round(W * 0.24), lh = topH;
    els.push({ type: 'image', src: opts.logoUrl, x: W - P - lw, y: P, w: lw, h: lh, fit: 'contain' });
  }

  // ----- white product panel -------------------------------------------------
  const barH = Math.round(H * 0.075);
  const panelY = P + topH + 6;
  const panelH = H - panelY - barH - P;
  els.push({ type: 'rect', x: innerX, y: panelY, w: innerW, h: panelH, fill: WHITE, radius: 18 });

  // Product name (black bold, top of panel).
  const nameSize = Math.round(W * 0.034);
  const name = (product.name || '').toUpperCase();
  els.push({
    type: 'text', text: name, x: innerX + innerW / 2, y: panelY + 24,
    size: nameSize, color: INK, weight: 'bold', align: 'center', maxWidth: innerW - 60,
  });
  const nameLines = estimateLines(name, nameSize, innerW - 60);
  const nameBlockH = nameLines * (nameSize + 8) + 16;

  // Product image (contain), centered in the remaining panel space.
  const imgTop = panelY + 24 + nameBlockH;
  const imgBottom = panelY + panelH - Math.round(panelH * 0.10);
  els.push({
    type: 'image', src: product.imageUrl,
    x: innerX + 50, y: imgTop, w: innerW - 100, h: Math.max(0, imgBottom - imgTop),
    fit: 'contain',
  });

  // ----- price box (white, red border) bottom-right --------------------------
  const price = Number.isFinite(product.priceSale) ? product.priceSale
    : Number.isFinite(product.priceNormal) ? product.priceNormal : null;
  const bw = Math.round(W * 0.34), bh = Math.round(H * 0.18);
  const bx = innerX + innerW - bw - 22;
  const by = panelY + panelH - bh - 20;

  // Code tag (red), right edge, just above the price box.
  if (product.code) {
    const tagW = Math.round(W * 0.18), tagH = Math.round(H * 0.046);
    const tagX = innerX + innerW - tagW - 22, tagY = by - tagH - 14;
    els.push({ type: 'rect', x: tagX, y: tagY, w: tagW, h: tagH, fill: RED, radius: 8 });
    els.push({
      type: 'text', text: 'รหัส ' + product.code, x: tagX + tagW / 2, y: tagY + tagH / 2,
      size: Math.round(tagH * 0.44), color: WHITE, weight: 'bold', align: 'center', maxWidth: tagW - 12,
    });
  }

  // "จำนวนจำกัด" (red, bold, bottom-left of panel).
  els.push({
    type: 'text', text: 'จำนวนจำกัด', x: innerX + 30, y: by + bh * 0.32,
    size: Math.round(W * 0.05), color: RED, weight: 'bold', align: 'left', maxWidth: innerW * 0.5,
  });

  if (price != null) {
    els.push({ type: 'rect', x: bx, y: by, w: bw, h: bh, fill: RED, radius: 18 });
    els.push({ type: 'rect', x: bx + 8, y: by + 8, w: bw - 16, h: bh - 16, fill: WHITE, radius: 12 });
    // Unit label like the real card ("กระปุกละ" / "ขวดละ"); strip "[45เม็ด]" noise.
    const cleanUnit = String(product.unitText || '').replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
    const unitLabel = cleanUnit ? `${cleanUnit}ละ` : 'ราคาพิเศษ';
    els.push({
      type: 'text', text: unitLabel, x: bx + bw / 2, y: by + bh * 0.24,
      size: Math.round(bh * 0.17), color: INK, weight: 'bold', align: 'center', maxWidth: bw - 20,
    });
    els.push({
      type: 'text', text: money(price) + '.-', x: bx + bw / 2, y: by + bh * 0.62,
      size: Math.round(bh * 0.48), color: RED, weight: 'bold', align: 'center', maxWidth: bw - 14,
    });
  }

  // ----- bottom gold strip: contact (left) + ส่งฟรี (right) ------------------
  const stripY = H - barH - P + 2;
  const contact = opts.contact || 'สั่งซื้อ/สอบถาม • LINE @cnypharmacy';
  els.push({
    type: 'text', text: contact, x: innerX + 8, y: stripY + barH / 2,
    size: Math.round(barH * 0.30), color: '#7A1400', weight: 'bold', align: 'left', maxWidth: innerW * 0.62,
  });
  if (opts.shipFree !== false) {
    const fw = Math.round(W * 0.16), fh = Math.round(barH * 0.7);
    const fx = innerX + innerW - fw - 8, fy = stripY + (barH - fh) / 2;
    els.push({ type: 'rect', x: fx, y: fy, w: fw, h: fh, fill: '#1B8A3A', radius: 999 });
    els.push({
      type: 'text', text: '🚚 ส่งฟรี', x: fx + fw / 2, y: fy + fh / 2,
      size: Math.round(fh * 0.42), color: WHITE, weight: 'bold', align: 'center', maxWidth: fw - 10,
    });
  }

  return { width: W, height: H, background: GOLD, elements: els };
}
