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

// preset -> the label used on the sale-price line
const SALE_LABEL = {
  flash:   'ราคา Flash Sale',
  lastlot: 'ราคาล็อตสุดท้าย',
  member:  'ราคาสมาชิก',
  custom:  'ราคาพิเศษ',
};

// preset -> an automatic supporting line (shown after the price block)
const PRESET_NOTE = {
  lastlot: '⚠️ จำนวนจำกัด ล็อตสุดท้ายก่อนปรับราคา',
  member:  '✨ สมัครสมาชิกวันนี้รับราคาพิเศษ',
};

// ---- public ---------------------------------------------------------------

export function buildBubble(product) {
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

  // optional supporting lines — included only when the product provides them
  let first = true;
  for (const [value, color] of [
    [product.expireText, badgeColor],
    [product.stockText, '#999999'],
    [product.pointsText, '#27AE60'],
    [product.note, '#999999'],
  ]) {
    if (!nonEmpty(value)) continue;
    body.push(text(value, {
      size: 'xs',
      color,
      wrap: true,
      ...(first ? { margin: 'sm' } : {}),
    }));
    first = false;
  }

  return {
    type: 'bubble',
    hero: {
      type: 'image',
      url: product.imageUrl,
      size: 'full',
      aspectRatio: '1:1',
      aspectMode: 'cover',
    },
    body: { type: 'box', layout: 'vertical', contents: body },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: badgeColor,
          action: {
            type: 'message',
            label: ctaLabel(product.code),
            text: `สนใจ รหัส ${product.code}`,
          },
        },
      ],
    },
  };
}

export function buildCarousel(products) {
  if (products.length > MAX_BUBBLES) {
    throw new Error(`carousel รับได้สูงสุด ${MAX_BUBBLES} bubble (ได้รับ ${products.length})`);
  }
  return { type: 'carousel', contents: products.map(buildBubble) };
}

// Auto-split into multiple carousels of <= 12 bubbles (design doc §4).
export function buildCarousels(products) {
  const chunks = [];
  for (let i = 0; i < products.length; i += MAX_BUBBLES) {
    chunks.push(buildCarousel(products.slice(i, i + MAX_BUBBLES)));
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
