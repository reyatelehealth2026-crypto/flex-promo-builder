// Promotion adapter — joins CNY active campaigns (`data_promotion_only`) onto
// catalog products, computing the discounted price + bulk-pack condition text
// exactly the way the cnypharmacy.com SPA does (the prices are NOT stored —
// the site computes them client-side).
//
// Campaign schema is identical whether the array comes from the public
// getDataProductIsGroup / searchProduct response or the auth-gated
// getPromotionProduct response, so the same pipeline serves both.
//
// Join key: `${product.productId}|${product.unit}` (the SPA joins on the
// product's PRIMARY unit only, which is what the flat catalog carries).

const toN = (v) => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Pull the campaign array out of any catalog/promo API response and index it
// by `${productId}|${unit}`. Skips the "free item" rows of giveaways.
export function extractPromotions(apiResponse) {
  const campaigns = apiResponse?.data_promotion_only || [];
  const map = new Map();
  for (const camp of campaigns) {
    const campaignText = camp.text || null; // giveaway text lives at campaign level
    for (const dp of camp.data_product || []) {
      if (dp.is_giveaway === 1) continue;   // the gifted product, not the qualifier
      const key = `${dp.id}|${dp.unit}`;
      if (map.has(key)) continue;
      map.set(key, { ...dp, campaignText });
    }
  }
  return map;
}

// flat catalog record + matched campaign -> enriched extension Product.
export function promoToProduct(flat, promo) {
  const base = toN(flat.basePrice);
  const discount = toN(promo.discount);
  const isGiveaway = promo.campaign_type === 'giveaway' || promo.is_giveaway === 1 || !!promo.campaignText;
  const isPercent = promo.discount_type === 'percent';

  let priceSale;
  let note;
  let badgeText = 'SPECIAL OFFER';
  let badgeColor = '#E8000D';

  if (isGiveaway && discount === 0) {
    note = promo.campaignText || promo.campaign_name || '';
    badgeText = '🎁 ของแถม';
    badgeColor = '#27AE60';
  } else if (isPercent) {
    priceSale = Math.round(base * (1 - discount / 100));
    note = buildCondition(promo, discount, true);
  } else {
    priceSale = base - discount;
    note = buildCondition(promo, discount, false);
  }

  const validSale = priceSale != null && priceSale > 0 && priceSale < base ? priceSale : undefined;

  return {
    code: String(flat.sku || '').trim(),
    name: String(flat.name || '').trim(),
    imageUrl: String(flat.image || '').trim(),
    priceNormal: base > 0 ? base : undefined,
    priceSale: validSale,
    promoType: 'custom', // badge overridden to SPECIAL OFFER; "ราคาพิเศษ" reads better than "Flash Sale" for bulk promos
    badgeText,
    badgeColor,
    note,
    unitText: promo.unit || flat.unit || '',
    _tags: ['promotion', ...(Array.isArray(flat.tags) ? flat.tags : [])],
    _promo: {
      qty: promo.qty,
      unit: promo.unit,
      discount,
      type: isGiveaway ? 'giveaway' : isPercent ? 'percent' : 'baht',
      isBuyPack: promo.is_buy_pack === 1,
      campaignName: promo.campaign_name || '',
      endsAt: promo.end_pro || null,
    },
  };
}

// Build the "ซื้อยกแพ็ค …" / "ซื้อ … ขึ้นไป …" condition line the SPA renders.
function buildCondition(dp, discount, isPercent) {
  const qty = dp.qty;
  const unit = dp.unit || '';
  if (dp.is_buy_pack === 1) {
    const lead = `ซื้อยกแพ็ค ${qty} ${unit}`;
    const tail = isPercent
      ? `ลดเพิ่ม ${money(discount)}%`
      : `ลดเพิ่มแพ็คละ ${money(Math.round(qty * discount))} บาท`;
    return `${lead} ${tail}`;
  }
  const lead = `ซื้อ ${qty} ${unit} ขึ้นไป`;
  const tail = isPercent
    ? `ลด ${money(discount)}%`
    : `ลด${unit} ละ ${money(discount)} บาท`;
  return `${lead} ${tail}`;
}

// catalog flats + campaign map -> only the products that have an active promo.
export function buildPromoProducts(flats, promoMap) {
  const out = [];
  for (const f of flats) {
    const promo = promoMap.get(`${f.productId}|${f.unit}`);
    if (!promo) continue;
    const p = promoToProduct(f, promo);
    if (p.code && p.name && /^https:\/\//i.test(p.imageUrl)) out.push(p);
  }
  return out;
}

export function money(n) {
  const r = Math.round(Number(n) * 100) / 100;
  const [int, dec] = r.toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec === '00' ? grouped : `${grouped}.${dec.replace(/0$/, '')}`;
}
