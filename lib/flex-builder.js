// Flex Builder — turns a Product + promo preset into a LINE Flex bubble,
// then assembles bubbles into a carousel.
//
// Internal API contract (per design doc §3.5):
//   buildBubble(product)        -> FlexBubble
//   buildCarousel(products)     -> FlexCarousel   // throws if > 12
//   buildCarousels(products)    -> FlexCarousel[] // auto-split by 12 (no throw)
//   buildFlexMessage(carousel)  -> Flex message envelope for the Messaging API

export const MAX_BUBBLES = 12;

// preset -> badge text + color (per design doc §3.4)
export const PRESETS = {
  flash:   { badgeText: '⚡ FLASH SALE',              badgeColor: '#E8000D' },
  lastlot: { badgeText: '🔥 ล็อตสุดท้ายก่อนปรับราคา', badgeColor: '#C0392B' },
  member:  { badgeText: '💎 ราคาสมาชิก',              badgeColor: '#8E44AD' },
  custom:  { badgeText: 'โปรพิเศษ',                   badgeColor: '#333333' },
};

// SPECIAL PROMO card palette (matches the compositor banner / cnypharmacy card).
const GOLD = '#FFC400';
const PROMO_RED = '#E2001A';
const INK = '#1A1A1A';

// bigprice / minimal / urgent template palette
const SALE_RED = '#E8000D';
const MINIMAL_BLUE = '#002689';   // pharmacy-clean blue accent
const URGENT_DARK = '#7A0010';    // dark red header strip

// preset -> the label used on the sale-price line (classic template)
const SALE_LABEL = {
  flash:   'ราคา Flash Sale',
  lastlot: 'ราคาล็อตสุดท้าย',
  member:  'ราคาสมาชิก',
  custom:  'ราคาพิเศษ',
};

// preset -> an automatic supporting line (classic template)
const PRESET_NOTE = {
  lastlot: '⚠️ จำนวนจำกัด ล็อตสุดท้ายก่อนปรับราคา',
  member:  '✨ สมัครสมาชิกวันนี้รับราคาพิเศษ',
};

// ---- public ---------------------------------------------------------------

// Build a bubble. opts.template selects the visual style:
//   'classic' (default) — the original layout
//   'promo'             — the cnypharmacy "SPECIAL PROMO" card style
//   'bigprice'          — ราคาเด่น: huge red sale price, struck normal, % chip
//   'minimal'           — มินิมอลสะอาด: big hero, name + price row, blue accent
//   'urgent'            — เร่งด่วน: dark-red countdown strip + red CTA box
const TEMPLATE_BUILDERS = {
  promo: promoBubble,
  bigprice: bigPriceBubble,
  minimal: minimalBubble,
  urgent: urgentBubble,
};

export function buildBubble(product, opts = {}) {
  return (TEMPLATE_BUILDERS[opts.template] || classicBubble)(product);
}

// A bubble styled like the cnypharmacy "SPECIAL PROMO" card: gold background,
// red promo badge, white product panel (name + image + code tag), a price box
// with red border ("[unit]ละ NNN.-"), "จำนวนจำกัด", and a "ส่งฟรี" pill.
function promoBubble(product) {
  const badgeText = nonEmpty(product.badgeText) || 'SPECIAL PROMO';
  const badgeColor = nonEmpty(product.badgeColor) || PROMO_RED;

  const price = isNum(product.priceSale) ? product.priceSale
    : isNum(product.priceNormal) ? product.priceNormal : null;
  const cleanUnit = String(product.unitText || '').replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
  const unitLabel = cleanUnit ? `${cleanUnit}ละ` : 'ราคาพิเศษ';

  // White product panel: name + image + (code tag).
  const panel = [
    text(product.name, { weight: 'bold', size: 'sm', color: INK, wrap: true, align: 'center' }),
    { type: 'image', url: product.imageUrl, size: 'full', aspectRatio: '1:1', aspectMode: 'fit', margin: 'sm' },
  ];
  if (nonEmpty(product.code)) {
    panel.push(pillRight(`รหัส ${product.code}`, PROMO_RED, '#FFFFFF'));
  }

  // Price row: "จำนวนจำกัด" (left) + white price box with red border (right).
  const priceRow = {
    type: 'box', layout: 'horizontal', alignItems: 'center', margin: 'md', spacing: 'sm',
    contents: [
      text('จำนวนจำกัด', { weight: 'bold', size: 'sm', color: PROMO_RED, gravity: 'center', flex: 4, wrap: true }),
      {
        type: 'box', layout: 'vertical', flex: 5, backgroundColor: '#FFFFFF',
        borderColor: PROMO_RED, borderWidth: '2px', cornerRadius: '8px', paddingAll: '5px',
        contents: [
          text(unitLabel, { size: 'xxs', color: INK, align: 'center' }),
          text(price != null ? `${money(price)}.-` : '—', { weight: 'bold', size: 'xxl', color: PROMO_RED, align: 'center' }),
        ],
      },
    ],
  };

  const body = {
    type: 'box', layout: 'vertical', backgroundColor: GOLD, paddingAll: '10px', spacing: 'sm',
    contents: [
      promoBadge(badgeText, badgeColor),
      { type: 'box', layout: 'vertical', backgroundColor: '#FFFFFF', cornerRadius: '10px', paddingAll: '8px', spacing: 'sm', contents: panel },
      priceRow,
    ],
  };
  if (nonEmpty(product.note)) {
    body.contents.push(text(product.note, { size: 'xxs', color: '#7A1400', wrap: true, align: 'center', margin: 'sm' }));
  }
  body.contents.push(shipFreePill());

  return {
    type: 'bubble',
    body,
    footer: {
      type: 'box', layout: 'vertical', backgroundColor: GOLD, paddingAll: '10px',
      contents: [
        {
          type: 'button', style: 'primary', color: PROMO_RED, height: 'sm',
          action: { type: 'message', label: ctaLabel(product.code), text: `สนใจ รหัส ${product.code}` },
        },
      ],
    },
  };
}

// The original bubble layout: hero image (cover), colored badge, name, price
// lines (ราคาปกติ struck / sale / ประหยัด), preset note + supporting lines, CTA.
function classicBubble(product) {
  const promoType = PRESETS[product.promoType] ? product.promoType : 'custom';
  const preset = PRESETS[promoType];
  const badgeText = nonEmpty(product.badgeText) || preset.badgeText;
  const badgeColor = nonEmpty(product.badgeColor) || preset.badgeColor;

  const body = [
    badgeBox(badgeText, badgeColor),
    text(product.name, { weight: 'bold', size: 'lg', color: '#d70f0f', wrap: true, margin: 'sm' }),
    ...priceLines(product, promoType, badgeColor),
  ];

  if (PRESET_NOTE[promoType]) {
    body.push(text(PRESET_NOTE[promoType], { size: 'xs', color: badgeColor, margin: 'sm' }));
  }

  let first = true;
  for (const [value, color] of [
    [product.expireText, badgeColor],
    [product.stockText, '#999999'],
    [product.pointsText, '#27AE60'],
    [product.note, '#999999'],
  ]) {
    if (!nonEmpty(value)) continue;
    body.push(text(value, { size: 'xs', color, wrap: true, ...(first ? { margin: 'sm' } : {}) }));
    first = false;
  }

  return {
    type: 'bubble',
    hero: { type: 'image', url: product.imageUrl, size: 'full', aspectRatio: '1:1', aspectMode: 'cover' },
    body: { type: 'box', layout: 'vertical', contents: body },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [{
        type: 'button', style: 'primary', color: badgeColor,
        action: { type: 'message', label: ctaLabel(product.code), text: `สนใจ รหัส ${product.code}` },
      }],
    },
  };
}

// ราคาเด่น: clean white card — small name, struck normal price, huge red sale
// price center, discount % chip. Minimal everything else.
function bigPriceBubble(product) {
  const hasNormal = isNum(product.priceNormal);
  const hasSale = isNum(product.priceSale);
  const hasDiscount = hasNormal && hasSale && product.priceNormal > product.priceSale;
  const price = hasSale ? product.priceSale : hasNormal ? product.priceNormal : null;

  const body = [
    text(product.name, { size: 'sm', color: '#555555', wrap: true, align: 'center' }),
  ];
  if (hasDiscount) {
    body.push(text(`ปกติ ฿${money(product.priceNormal)}`, {
      size: 'sm', color: '#999999', decoration: 'line-through', align: 'center', margin: 'md',
    }));
  }
  body.push(text(price != null ? `฿${money(price)}` : 'สอบถามราคา', {
    weight: 'bold', size: 'xxl', color: SALE_RED, align: 'center', margin: hasDiscount ? 'xs' : 'md',
  }));
  if (hasDiscount) {
    const pct = Math.round((1 - product.priceSale / product.priceNormal) * 100);
    if (pct > 0) body.push(pillCenter(`ลด ${pct}%`, SALE_RED, '#FFFFFF'));
  }
  if (nonEmpty(product.code)) {
    body.push(text(`รหัส ${product.code}`, { size: 'xxs', color: '#BBBBBB', align: 'center', margin: 'md' }));
  }

  return {
    type: 'bubble',
    hero: { type: 'image', url: product.imageUrl, size: 'full', aspectRatio: '1:1', aspectMode: 'cover' },
    body: { type: 'box', layout: 'vertical', backgroundColor: '#FFFFFF', paddingAll: '16px', contents: body },
  };
}

// มินิมอลสะอาด: big hero (fit, no crop), name, thin separator, price row with
// blue accent. Lots of whitespace, no badge clutter.
function minimalBubble(product) {
  const hasSale = isNum(product.priceSale);
  const price = hasSale ? product.priceSale : isNum(product.priceNormal) ? product.priceNormal : null;
  const cleanUnit = String(product.unitText || '').replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();

  return {
    type: 'bubble',
    hero: {
      type: 'image', url: product.imageUrl, size: 'full',
      aspectRatio: '1:1', aspectMode: 'fit', backgroundColor: '#FFFFFF',
    },
    body: {
      type: 'box', layout: 'vertical', backgroundColor: '#FFFFFF', paddingAll: '20px',
      contents: [
        text(product.name, { weight: 'bold', size: 'md', color: INK, wrap: true }),
        { type: 'separator', margin: 'lg', color: '#E6EAF2' },
        {
          type: 'box', layout: 'horizontal', margin: 'lg', alignItems: 'center',
          contents: [
            text(cleanUnit ? `ราคา / ${cleanUnit}` : 'ราคา', { size: 'xs', color: '#8A93A6', gravity: 'center', flex: 3 }),
            text(price != null ? `฿${money(price)}` : '—', {
              weight: 'bold', size: 'xl', color: MINIMAL_BLUE, align: 'end', flex: 4,
            }),
          ],
        },
      ],
    },
  };
}

// เร่งด่วน: dark-red header strip "⏰ ด่วน! โปรหมดเร็ว" (+ endsAt when present),
// prominent price, note line, red CTA-style footer text box.
function urgentBubble(product) {
  const endsAt = nonEmpty(product?._promo?.endsAt);
  const stripText = endsAt ? `⏰ ด่วน! โปรหมดเร็ว ถึง ${endsAt}` : '⏰ ด่วน! โปรหมดเร็ว';
  const hasNormal = isNum(product.priceNormal);
  const hasSale = isNum(product.priceSale);
  const price = hasSale ? product.priceSale : hasNormal ? product.priceNormal : null;

  const info = [
    text(product.name, { weight: 'bold', size: 'md', color: INK, wrap: true }),
  ];
  if (hasNormal && hasSale && product.priceNormal > product.priceSale) {
    info.push(text(`ราคาปกติ ฿${money(product.priceNormal)}`, {
      size: 'sm', color: '#999999', decoration: 'line-through', margin: 'sm',
    }));
  }
  info.push(text(price != null ? `฿${money(price)}` : 'สอบถามราคา', {
    weight: 'bold', size: 'xxl', color: SALE_RED, margin: 'xs',
  }));
  if (nonEmpty(product.note)) {
    info.push(text(product.note, { size: 'xs', color: '#7A1400', wrap: true, margin: 'sm' }));
  }

  return {
    type: 'bubble',
    body: {
      type: 'box', layout: 'vertical', paddingAll: '0px',
      contents: [
        {
          type: 'box', layout: 'vertical', backgroundColor: URGENT_DARK, paddingAll: '8px',
          contents: [text(stripText, { weight: 'bold', size: 'sm', color: '#FFFFFF', align: 'center', wrap: true })],
        },
        { type: 'image', url: product.imageUrl, size: 'full', aspectRatio: '1:1', aspectMode: 'cover' },
        { type: 'box', layout: 'vertical', paddingAll: '12px', contents: info },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', backgroundColor: SALE_RED, paddingAll: '10px',
      contents: [text(
        nonEmpty(product.code) ? `สนใจ ทักเลย! รหัส ${product.code}` : 'สนใจ ทักแชทเลย!',
        { weight: 'bold', size: 'sm', color: '#FFFFFF', align: 'center', wrap: true },
      )],
    },
  };
}

export function buildCarousel(products, opts = {}) {
  if (products.length > MAX_BUBBLES) {
    throw new Error(`carousel รับได้สูงสุด ${MAX_BUBBLES} bubble (ได้รับ ${products.length})`);
  }
  return { type: 'carousel', contents: products.map((p) => buildBubble(p, opts)) };
}

// Auto-split into multiple carousels of <= 12 bubbles (design doc §4).
export function buildCarousels(products, opts = {}) {
  const chunks = [];
  for (let i = 0; i < products.length; i += MAX_BUBBLES) {
    chunks.push(buildCarousel(products.slice(i, i + MAX_BUBBLES), opts));
  }
  return chunks;
}

export function buildFlexMessage(carousel, altText) {
  return {
    type: 'flex',
    altText: altText || 'โปรโมชั่นสินค้า',
    contents: carousel,
  };
}

// ---- internals ------------------------------------------------------------

function priceLines(p, promoType, saleColor) {
  const lines = [];
  const hasNormal = isNum(p.priceNormal);
  const hasSale = isNum(p.priceSale);

  if (hasNormal && hasSale) {
    lines.push(text(`ราคาปกติ ฿${money(p.priceNormal)}`, {
      size: 'sm', color: '#999999', decoration: 'line-through', margin: 'sm',
    }));
    lines.push(text(`${SALE_LABEL[promoType]} ฿${money(p.priceSale)}`, {
      weight: 'bold', size: 'md', color: saleColor,
    }));
    const save = p.priceNormal - p.priceSale;
    if (save > 0) {
      lines.push(text(`ประหยัด ฿${money(save)}`, { size: 'sm', color: '#27AE60' }));
    }
  } else if (hasSale) {
    lines.push(text(`${SALE_LABEL[promoType]} ฿${money(p.priceSale)}`, {
      weight: 'bold', size: 'md', color: saleColor, margin: 'sm',
    }));
  } else if (hasNormal) {
    lines.push(text(`ราคา ฿${money(p.priceNormal)}`, {
      weight: 'bold', size: 'md', color: saleColor, margin: 'sm',
    }));
  }
  return lines;
}

function badgeBox(badgeText, badgeColor) {
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: badgeColor,
    paddingAll: '4px',
    contents: [
      text(badgeText, { weight: 'bold', size: 'sm', color: '#FFFFFF', align: 'center' }),
    ],
  };
}

// ---- SPECIAL PROMO template helpers ---------------------------------------

// Left-aligned red promo badge (yellow text), like the card's starburst seal.
function promoBadge(badgeText, color) {
  return {
    type: 'box', layout: 'horizontal',
    contents: [
      {
        type: 'box', layout: 'vertical', flex: 0, backgroundColor: color, cornerRadius: '6px',
        paddingAll: '4px', paddingStart: '10px', paddingEnd: '10px',
        contents: [text(badgeText, { weight: 'bold', size: 'xs', color: '#FFE000', align: 'center' })],
      },
      { type: 'filler' },
    ],
  };
}

// A right-hugging coloured pill (used for the "รหัส XXXX" tag).
function pillRight(label, bg, fg) {
  return {
    type: 'box', layout: 'horizontal',
    contents: [
      { type: 'filler' },
      {
        type: 'box', layout: 'vertical', flex: 0, backgroundColor: bg, cornerRadius: '6px',
        paddingAll: '2px', paddingStart: '8px', paddingEnd: '8px',
        contents: [text(label, { size: 'xxs', color: fg, align: 'center' })],
      },
    ],
  };
}

// A centered coloured pill (used for the discount % chip).
function pillCenter(label, bg, fg) {
  return {
    type: 'box', layout: 'horizontal', margin: 'sm',
    contents: [
      { type: 'filler' },
      {
        type: 'box', layout: 'vertical', flex: 0, backgroundColor: bg, cornerRadius: '999px',
        paddingAll: '3px', paddingStart: '12px', paddingEnd: '12px',
        contents: [text(label, { weight: 'bold', size: 'xs', color: fg, align: 'center' })],
      },
      { type: 'filler' },
    ],
  };
}

// Centered green "ส่งฟรี" pill.
function shipFreePill() {
  return {
    type: 'box', layout: 'horizontal', margin: 'sm',
    contents: [
      { type: 'filler' },
      {
        type: 'box', layout: 'vertical', flex: 0, backgroundColor: '#1B8A3A', cornerRadius: '999px',
        paddingAll: '3px', paddingStart: '12px', paddingEnd: '12px',
        contents: [text('🚚 ส่งฟรี', { size: 'xxs', color: '#FFFFFF', align: 'center' })],
      },
      { type: 'filler' },
    ],
  };
}

function text(value, opts = {}) {
  return { type: 'text', text: String(value), ...opts };
}

// LINE caps button action labels at 20 chars; keep the full intent in `text`.
function ctaLabel(code) {
  const label = `สนใจ รหัส ${code}`;
  return label.length <= 20 ? label : label.slice(0, 20);
}

function money(n) {
  const r = Math.round(Number(n) * 100) / 100; // tame float error (e.g. 26.6699999)
  const [int, dec] = r.toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec === '00' ? grouped : `${grouped}.${dec.replace(/0$/, '')}`;
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function nonEmpty(v) {
  return v !== undefined && v !== null && String(v).trim() !== '' ? v : null;
}
