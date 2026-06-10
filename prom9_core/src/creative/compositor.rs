//! Compositor — port of `lib/compositor.js`.
//!
//! Computes a "draw plan" for a promo banner that a renderer (canvas,
//! Flutter `CustomPainter`, ...) later executes. This module does NO drawing:
//! it is pure data. All coordinates are absolute pixels inside the
//! `[0,width] x [0,height]` box.
//!
//! Element ops (same wire shape as the JS module when serialized):
//!   `{ type:'rect',  x,y,w,h, fill, radius? }`
//!   `{ type:'image', src, x,y,w,h, fit:'cover'|'contain' }`
//!   `{ type:'text',  text, x,y, size, color, weight, align, strike?, maxWidth? }`
//!   `{ type:'burst', cx,cy, rOuter,rInner, points, fill }`   (promo card seal)

use serde::{Deserialize, Serialize};

use crate::flex::builder::Product;
use crate::jsutil::{group_thousands, js_math_round, js_num_to_string, js_trim, strip_bracketed, utf16_len};

/// Canvas dimensions per size key (`SIZES`).
pub const SIZES: [(&str, u32, u32); 4] = [
    ("square", 1080, 1080),
    ("portrait", 1080, 1350),
    ("story", 1080, 1920),
    ("line", 1040, 1040),
];

/// Resolve a size key; unknown/missing keys fall back to `square`.
pub fn size_for(key: Option<&str>) -> (u32, u32) {
    key.and_then(|k| SIZES.iter().find(|(name, _, _)| *name == k))
        .map(|(_, w, h)| (*w, *h))
        .unwrap_or((1080, 1080))
}

/// One draw operation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Element {
    Rect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        fill: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        radius: Option<f64>,
    },
    Image {
        #[serde(skip_serializing_if = "Option::is_none")]
        src: Option<String>,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        /// "cover" | "contain"
        fit: String,
    },
    Text {
        text: String,
        x: f64,
        y: f64,
        size: f64,
        color: String,
        weight: String,
        align: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        strike: Option<bool>,
        #[serde(rename = "maxWidth", skip_serializing_if = "Option::is_none")]
        max_width: Option<f64>,
    },
    Burst {
        cx: f64,
        cy: f64,
        #[serde(rename = "rOuter")]
        r_outer: f64,
        #[serde(rename = "rInner")]
        r_inner: f64,
        points: u32,
        fill: String,
    },
}

/// A complete plan: `{ width, height, background, elements }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DrawPlan {
    pub width: u32,
    pub height: u32,
    pub background: String,
    pub elements: Vec<Element>,
}

/// Partial brand override (`opts.brand`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct BrandOverride {
    pub primary: Option<String>,
    pub accent: Option<String>,
    pub ink: Option<String>,
    pub bg: Option<String>,
}

/// Options for all three plan builders (the JS modules share one opts object).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CompositorOpts {
    /// "square" | "portrait" | "story" | "line" (default "square").
    pub size: Option<String>,
    /// banner: "classic" (default) | "bold" | "cny" (festive colors) | "promo"
    /// (delegates to [`build_promo_card`]).
    pub template: Option<String>,
    pub brand: Option<BrandOverride>,
    // promo-card extras:
    pub logo_url: Option<String>,
    pub contact: Option<String>,
    /// `opts.shipFree !== false` — only an explicit `Some(false)` hides the pill.
    pub ship_free: Option<bool>,
    // overlay extras:
    pub bg_image: Option<String>,
    pub cta: Option<String>,
}

#[derive(Clone)]
struct Brand {
    primary: String,
    accent: String,
    ink: String,
    bg: String,
}

const DEFAULT_BRAND: (&str, &str, &str, &str) = ("#E8000D", "#27AE60", "#222222", "#FFFFFF");
// Festive brand preset selectable as template "cny" (colors only).
const CNY_BRAND: (&str, &str, &str, &str) = ("#C8102E", "#F4C430", "#7A1416", "#FFF7E6");

fn resolve_brand(preset: Option<(&str, &str, &str, &str)>, over: Option<&BrandOverride>) -> Brand {
    let (mut primary, mut accent, mut ink, mut bg) = DEFAULT_BRAND;
    if let Some((p, a, i, b)) = preset {
        primary = p;
        accent = a;
        ink = i;
        bg = b;
    }
    let mut brand = Brand {
        primary: primary.to_string(),
        accent: accent.to_string(),
        ink: ink.to_string(),
        bg: bg.to_string(),
    };
    if let Some(o) = over {
        if let Some(v) = &o.primary {
            brand.primary = v.clone();
        }
        if let Some(v) = &o.accent {
            brand.accent = v.clone();
        }
        if let Some(v) = &o.ink {
            brand.ink = v.clone();
        }
        if let Some(v) = &o.bg {
            brand.bg = v.clone();
        }
    }
    brand
}

/// `money(n)`: thousand-separated, drops a trailing ".00" but KEEPS two
/// fractional digits otherwise (`26.6` -> "26.60"), tames float drift via
/// integer cents (`731.3299999` -> "731.33"). Non-finite -> "0".
pub fn money(n: f64) -> String {
    if !n.is_finite() {
        return "0".to_string();
    }
    // Round to 2 decimals via integer cents to kill float drift.
    let cents = js_math_round((n + f64::EPSILON) * 100.0);
    let sign = if cents < 0.0 { "-" } else { "" };
    let abs = cents.abs();
    let whole = (abs / 100.0).trunc().min(i128::MAX as f64) as i128;
    let frac = (abs % 100.0) as i64;

    let grouped_whole = group_thousands(&whole.to_string());
    if frac == 0 {
        return format!("{sign}{grouped_whole}");
    }
    format!("{sign}{grouped_whole}.{frac:02}")
}

// ---------------------------------------------------------------------------
// Small layout helpers
// ---------------------------------------------------------------------------

/// `Math.max(lo, Math.min(hi, v))`
fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    lo.max(hi.min(v))
}

/// Rough word-wrap estimate (UTF-16 length / ~0.55em advance). Lines >= 1.
fn estimate_lines(text: &str, size: f64, max_width: f64) -> f64 {
    if text.is_empty() || max_width == 0.0 {
        return 1.0;
    }
    let chars_per_line = (max_width / (size * 0.55)).floor().max(1.0);
    (utf16_len(text) as f64 / chars_per_line).ceil().max(1.0)
}

fn is_num(v: Option<f64>) -> Option<f64> {
    v.filter(|x| x.is_finite())
}

/// `v || fallback` for optional strings (JS truthiness: "" is falsy).
fn or_str<'a>(v: Option<&'a str>, fallback: &'a str) -> &'a str {
    match v {
        Some(s) if !s.is_empty() => s,
        _ => fallback,
    }
}

// JS `src: product.imageUrl` keeps an empty string as-is (it would only be
// omitted for `undefined`, which a typed Product cannot produce).
fn src_of(url: &str) -> Option<String> {
    Some(url.to_string())
}

// Clamp an element's origin into the canvas box (the banner builder's `push`).
fn push_clamped(elements: &mut Vec<Element>, width: f64, height: f64, mut el: Element) {
    match &mut el {
        Element::Rect { x, y, .. } | Element::Image { x, y, .. } | Element::Text { x, y, .. } => {
            *x = clamp(*x, 0.0, width);
            *y = clamp(*y, 0.0, height);
        }
        Element::Burst { .. } => {}
    }
    elements.push(el);
}

// ---------------------------------------------------------------------------
// buildBanner(product, opts) -> draw plan
// ---------------------------------------------------------------------------
pub fn build_banner(product: &Product, opts: &CompositorOpts) -> DrawPlan {
    // The cnypharmacy "SPECIAL PROMO" card is its own full layout.
    if opts.template.as_deref() == Some("promo") {
        return build_promo_card(product, opts);
    }

    let (width_u, height_u) = size_for(opts.size.as_deref());
    let (width, height) = (width_u as f64, height_u as f64);

    let is_festive = opts.template.as_deref() == Some("cny");
    let bold = opts.template.as_deref() == Some("bold") || is_festive;
    let brand = resolve_brand(is_festive.then_some(CNY_BRAND), opts.brand.as_ref());

    const PAD: f64 = 48.0;
    let inner_w = width - PAD * 2.0;

    let mut elements: Vec<Element> = vec![];
    macro_rules! push {
        ($el:expr) => {
            push_clamped(&mut elements, width, height, $el)
        };
    }

    // 1) Background fill.
    push!(Element::Rect { x: 0.0, y: 0.0, w: width, h: height, fill: brand.bg.clone(), radius: None });

    // ----- Image region (top ~58%) -------------------------------------------
    let image_region_h = js_math_round(height * 0.58);

    if bold {
        // Bold: full-bleed colored header behind the product image.
        push!(Element::Rect { x: 0.0, y: 0.0, w: width, h: image_region_h, fill: brand.primary.clone(), radius: None });
    } else {
        // Classic: a light card rect that the product image sits on.
        push!(Element::Rect {
            x: PAD,
            y: PAD,
            w: inner_w,
            h: image_region_h - PAD,
            fill: "#F4F4F4".to_string(),
            radius: Some(24.0),
        });
    }

    // Product image, fit 'contain', inset inside the region.
    let img_inset = if bold { 64.0 } else { PAD + 24.0 };
    let img_x = img_inset;
    let img_y = if bold { 48.0 } else { PAD + 24.0 };
    let img_w = width - img_inset * 2.0;
    let img_h = image_region_h - img_y - 24.0;
    push!(Element::Image {
        src: src_of(&product.image_url),
        x: img_x,
        y: img_y,
        w: img_w.max(0.0),
        h: img_h.max(0.0),
        fit: "contain".to_string(),
    });

    // ----- SPECIAL-OFFER badge -------------------------------------------------
    let badge_text = or_str(product.badge_text.as_deref(), "SPECIAL OFFER");
    let badge_color = or_str(product.badge_color.as_deref(), &brand.primary).to_string();
    let badge_h = 64.0;
    let badge_y = PAD;
    let badge_w = clamp(js_math_round(utf16_len(badge_text) as f64 * 22.0 + 56.0), 180.0, inner_w);
    let badge_x = PAD;
    push!(Element::Rect { x: badge_x, y: badge_y, w: badge_w, h: badge_h, fill: badge_color, radius: Some(12.0) });
    push!(Element::Text {
        text: badge_text.to_string(),
        x: badge_x + badge_w / 2.0,
        y: badge_y + badge_h / 2.0,
        size: 30.0,
        color: "#FFFFFF".to_string(),
        weight: "bold".to_string(),
        align: "center".to_string(),
        strike: None,
        max_width: Some(badge_w - 24.0),
    });

    // ----- Text block (below the image region) --------------------------------
    let mut cursor_y = image_region_h + PAD;

    let name_size = if bold { 56.0 } else { 50.0 };
    let name = product.name.as_str();
    push!(Element::Text {
        text: name.to_string(),
        x: PAD,
        y: cursor_y,
        size: name_size,
        color: brand.ink.clone(),
        weight: "bold".to_string(),
        align: "left".to_string(),
        strike: None,
        max_width: Some(inner_w),
    });
    cursor_y += estimate_lines(name, name_size, inner_w) * (name_size + 12.0) + 16.0;

    // ----- Price block ----------------------------------------------------------
    let normal = is_num(product.price_normal);
    let sale = is_num(product.price_sale);
    let sale_size = if bold { 96.0 } else { 76.0 };

    if let (Some(n), Some(s)) = (normal, sale) {
        // Normal (small grey, struck through).
        let normal_size = 34.0;
        push!(Element::Text {
            text: format!("ราคาปกติ ฿{}", money(n)),
            x: PAD,
            y: cursor_y,
            size: normal_size,
            color: "#999999".to_string(),
            weight: "normal".to_string(),
            align: "left".to_string(),
            strike: Some(true),
            max_width: Some(inner_w),
        });
        cursor_y += normal_size + 14.0;

        // Sale (large, bold, primary).
        push!(Element::Text {
            text: format!("฿{}", money(s)),
            x: PAD,
            y: cursor_y,
            size: sale_size,
            color: brand.primary.clone(),
            weight: "bold".to_string(),
            align: "left".to_string(),
            strike: None,
            max_width: Some(inner_w),
        });
        cursor_y += sale_size + 12.0;

        // Savings (accent).
        let save = n - s;
        if save > 0.0 {
            let save_size = 36.0;
            push!(Element::Text {
                text: format!("ประหยัด ฿{}", money(save)),
                x: PAD,
                y: cursor_y,
                size: save_size,
                color: brand.accent.clone(),
                weight: "bold".to_string(),
                align: "left".to_string(),
                strike: None,
                max_width: Some(inner_w),
            });
            cursor_y += save_size + 12.0;
        }
    } else if let Some(single) = sale.or(normal) {
        push!(Element::Text {
            text: format!("฿{}", money(single)),
            x: PAD,
            y: cursor_y,
            size: sale_size,
            color: brand.primary.clone(),
            weight: "bold".to_string(),
            align: "left".to_string(),
            strike: None,
            max_width: Some(inner_w),
        });
        cursor_y += sale_size + 12.0;
    }

    // Optional unit / stock supporting lines.
    for extra in [product.unit_text.as_deref(), product.stock_text.as_deref()] {
        if let Some(extra) = extra.filter(|s| !s.is_empty()) {
            push!(Element::Text {
                text: extra.to_string(),
                x: PAD,
                y: cursor_y,
                size: 30.0,
                color: "#666666".to_string(),
                weight: "normal".to_string(),
                align: "left".to_string(),
                strike: None,
                max_width: Some(inner_w),
            });
            cursor_y += 30.0 + 10.0;
        }
    }

    // ----- Bottom brand bar (reserve space first) -------------------------------
    let bar_h = 84.0;
    let bar_y = height - bar_h;

    // ----- Promo condition (product.note), small, above the brand bar -----------
    if let Some(note) = product.note.as_deref().filter(|s| !s.is_empty()) {
        let note_size = 30.0;
        let note_lines = estimate_lines(note, note_size, inner_w);
        let note_block_h = note_lines * (note_size + 8.0);
        // Place it so it never collides with the brand bar (faithful port:
        // with lo == cursorY this clamp always resolves to cursorY).
        let note_y = clamp(cursor_y, cursor_y, bar_y - note_block_h - 12.0);
        push!(Element::Text {
            text: note.to_string(),
            x: PAD,
            y: note_y,
            size: note_size,
            color: "#777777".to_string(),
            weight: "normal".to_string(),
            align: "left".to_string(),
            strike: None,
            max_width: Some(inner_w),
        });
    }

    // Brand bar rect + white code text.
    push!(Element::Rect { x: 0.0, y: bar_y, w: width, h: bar_h, fill: brand.primary.clone(), radius: None });
    push!(Element::Text {
        text: format!("รหัส {}", product.code),
        x: width / 2.0,
        y: bar_y + bar_h / 2.0,
        size: 34.0,
        color: "#FFFFFF".to_string(),
        weight: "bold".to_string(),
        align: "center".to_string(),
        strike: None,
        max_width: Some(inner_w),
    });

    DrawPlan { width: width_u, height: height_u, background: brand.bg, elements }
}

// ---------------------------------------------------------------------------
// pctOff(product): discount percent for the corner chip.
// ---------------------------------------------------------------------------
fn pct_off(p: &Product) -> f64 {
    if let Some(promo) = &p.promo {
        if promo.kind == "percent" && promo.discount > 0.0 {
            return js_math_round(promo.discount);
        }
    }
    if let (Some(s), Some(n)) = (p.price_sale.filter(|v| v.is_finite()), p.price_normal) {
        if n > 0.0 && s < n {
            return js_math_round((1.0 - s / n) * 100.0);
        }
    }
    0.0
}

// ---------------------------------------------------------------------------
// buildOverlay(product, opts) -> draw plan
// Lays crisp promo TEXT (badge / price / CTA) over a full-bleed background
// image (opts.bg_image, typically an AI scene) so Thai text stays sharp.
// ---------------------------------------------------------------------------
pub fn build_overlay(product: &Product, opts: &CompositorOpts) -> DrawPlan {
    let (width_u, height_u) = size_for(opts.size.as_deref());
    let (width, height) = (width_u as f64, height_u as f64);
    let brand = resolve_brand(None, opts.brand.as_ref());
    const PAD: f64 = 48.0;
    let inner_w = width - PAD * 2.0;
    let mut elements: Vec<Element> = vec![];

    // 1) Full-bleed background image, cropped to fill.
    elements.push(Element::Image {
        src: opts
            .bg_image
            .as_deref()
            .filter(|s| !s.is_empty()) // JS `opts.bgImage || product.imageUrl`
            .map(str::to_string)
            .or_else(|| src_of(&product.image_url)),

        x: 0.0,
        y: 0.0,
        w: width,
        h: height,
        fit: "cover".to_string(),
    });

    // 2) SPECIAL-OFFER badge (top-left).
    let badge_text = or_str(product.badge_text.as_deref(), "SPECIAL OFFER");
    let badge_color = or_str(product.badge_color.as_deref(), &brand.primary).to_string();
    let badge_h = 64.0;
    let badge_w = clamp(js_math_round(utf16_len(badge_text) as f64 * 22.0 + 56.0), 180.0, inner_w);
    elements.push(Element::Rect { x: PAD, y: PAD, w: badge_w, h: badge_h, fill: badge_color, radius: Some(12.0) });
    elements.push(Element::Text {
        text: badge_text.to_string(),
        x: PAD + badge_w / 2.0,
        y: PAD + badge_h / 2.0,
        size: 30.0,
        color: "#FFFFFF".to_string(),
        weight: "bold".to_string(),
        align: "center".to_string(),
        strike: None,
        max_width: Some(badge_w - 24.0),
    });

    // 3) Discount chip (top-right).
    let pct = pct_off(product);
    if pct != 0.0 {
        let (chip_w, chip_h) = (156.0, 64.0);
        elements.push(Element::Rect {
            x: width - PAD - chip_w,
            y: PAD,
            w: chip_w,
            h: chip_h,
            fill: brand.primary.clone(),
            radius: Some(12.0),
        });
        elements.push(Element::Text {
            text: format!("ลด {}%", js_num_to_string(pct)),
            x: width - PAD - chip_w / 2.0,
            y: PAD + chip_h / 2.0,
            size: 36.0,
            color: "#FFFFFF".to_string(),
            weight: "bold".to_string(),
            align: "center".to_string(),
            strike: None,
            max_width: Some(chip_w - 16.0),
        });
    }

    // 4) Bottom scrim (semi-transparent) for text legibility.
    let bar_h = js_math_round(height * 0.36);
    let bar_y = height - bar_h;
    elements.push(Element::Rect { x: 0.0, y: bar_y, w: width, h: bar_h, fill: "rgba(0,0,0,0.55)".to_string(), radius: None });

    // 5) Text stack inside the scrim.
    let mut cy = bar_y + 28.0;
    let name = product.name.as_str();
    let name_size = 46.0;
    elements.push(Element::Text {
        text: name.to_string(),
        x: PAD,
        y: cy,
        size: name_size,
        color: "#FFFFFF".to_string(),
        weight: "bold".to_string(),
        align: "left".to_string(),
        strike: None,
        max_width: Some(inner_w),
    });
    cy += estimate_lines(name, name_size, inner_w) * (name_size + 10.0) + 12.0;

    let normal = is_num(product.price_normal);
    let sale = is_num(product.price_sale);
    if let (Some(n), Some(s)) = (normal, sale) {
        elements.push(Element::Text {
            text: format!("ราคาปกติ ฿{}", money(n)),
            x: PAD,
            y: cy,
            size: 32.0,
            color: "#DDDDDD".to_string(),
            weight: "normal".to_string(),
            align: "left".to_string(),
            strike: Some(true),
            max_width: Some(inner_w),
        });
        cy += 32.0 + 12.0;
        elements.push(Element::Text {
            text: format!("฿{}", money(s)),
            x: PAD,
            y: cy,
            size: 88.0,
            color: "#FFD60A".to_string(),
            weight: "bold".to_string(),
            align: "left".to_string(),
            strike: None,
            max_width: Some(inner_w),
        });
    } else if let Some(single) = sale.or(normal) {
        elements.push(Element::Text {
            text: format!("฿{}", money(single)),
            x: PAD,
            y: cy,
            size: 88.0,
            color: "#FFD60A".to_string(),
            weight: "bold".to_string(),
            align: "left".to_string(),
            strike: None,
            max_width: Some(inner_w),
        });
    }

    // 6) CTA (bottom strip).
    let cta = or_str(opts.cta.as_deref(), "สั่งเลย • ทักแชทร้าน");
    elements.push(Element::Text {
        text: cta.to_string(),
        x: PAD,
        y: height - 40.0,
        size: 30.0,
        color: "#FFFFFF".to_string(),
        weight: "bold".to_string(),
        align: "left".to_string(),
        strike: None,
        max_width: Some(inner_w),
    });

    DrawPlan { width: width_u, height: height_u, background: brand.bg, elements }
}

// ---------------------------------------------------------------------------
// buildPromoCard(product, opts) -> draw plan
// Replicates the cnypharmacy "SPECIAL PROMO" card: gold background, red promo
// seal, real product photo on a white panel, code tag, "จำนวนจำกัด", a white
// price box with red border, and a bottom contact / ส่งฟรี strip.
// ---------------------------------------------------------------------------
pub fn build_promo_card(product: &Product, opts: &CompositorOpts) -> DrawPlan {
    let (w_u, h_u) = size_for(opts.size.as_deref());
    let (w, h) = (w_u as f64, h_u as f64);

    const GOLD: &str = "#FFC400";
    const RED: &str = "#E2001A";
    const INK: &str = "#1A1A1A";
    const WHITE: &str = "#FFFFFF";
    let mut els: Vec<Element> = vec![];
    let p_pad = js_math_round(w * 0.026); // outer gold frame
    let inner_x = p_pad;
    let inner_w = w - p_pad * 2.0;

    // Background gold.
    els.push(Element::Rect { x: 0.0, y: 0.0, w, h, fill: GOLD.to_string(), radius: None });

    // ----- top row: SPECIAL PROMO starburst seal (left) + logo (right) ---------
    let top_h = js_math_round(h * 0.115);
    let seal_r = js_math_round(top_h * 0.74);
    let cx = inner_x + 10.0 + seal_r;
    let cy = p_pad + seal_r;
    els.push(Element::Burst {
        cx,
        cy,
        r_outer: seal_r,
        r_inner: js_math_round(seal_r * 0.80),
        points: 14,
        fill: RED.to_string(),
    });
    els.push(Element::Text {
        text: "SPECIAL".to_string(),
        x: cx,
        y: cy - seal_r * 0.24,
        size: js_math_round(seal_r * 0.34),
        color: "#FFE000".to_string(),
        weight: "bold".to_string(),
        align: "center".to_string(),
        strike: None,
        max_width: Some(seal_r * 1.7),
    });
    els.push(Element::Text {
        text: "PROMO".to_string(),
        x: cx,
        y: cy + seal_r * 0.24,
        size: js_math_round(seal_r * 0.34),
        color: WHITE.to_string(),
        weight: "bold".to_string(),
        align: "center".to_string(),
        strike: None,
        max_width: Some(seal_r * 1.7),
    });
    if let Some(logo) = opts.logo_url.as_deref().filter(|s| !s.is_empty()) {
        let lw = js_math_round(w * 0.24);
        let lh = top_h;
        els.push(Element::Image {
            src: Some(logo.to_string()),
            x: w - p_pad - lw,
            y: p_pad,
            w: lw,
            h: lh,
            fit: "contain".to_string(),
        });
    }

    // ----- white product panel ---------------------------------------------------
    let bar_h = js_math_round(h * 0.075);
    let panel_y = p_pad + top_h + 6.0;
    let panel_h = h - panel_y - bar_h - p_pad;
    els.push(Element::Rect { x: inner_x, y: panel_y, w: inner_w, h: panel_h, fill: WHITE.to_string(), radius: Some(18.0) });

    // Product name (black bold, top of panel).
    let name_size = js_math_round(w * 0.034);
    let name = product.name.to_uppercase();
    els.push(Element::Text {
        text: name.clone(),
        x: inner_x + inner_w / 2.0,
        y: panel_y + 24.0,
        size: name_size,
        color: INK.to_string(),
        weight: "bold".to_string(),
        align: "center".to_string(),
        strike: None,
        max_width: Some(inner_w - 60.0),
    });
    let name_lines = estimate_lines(&name, name_size, inner_w - 60.0);
    let name_block_h = name_lines * (name_size + 8.0) + 16.0;

    // Product image (contain), centered in the remaining panel space.
    let img_top = panel_y + 24.0 + name_block_h;
    let img_bottom = panel_y + panel_h - js_math_round(panel_h * 0.10);
    els.push(Element::Image {
        src: src_of(&product.image_url),
        x: inner_x + 50.0,
        y: img_top,
        w: inner_w - 100.0,
        h: (img_bottom - img_top).max(0.0),
        fit: "contain".to_string(),
    });

    // ----- price box (white, red border) bottom-right ------------------------------
    let price = is_num(product.price_sale).or_else(|| is_num(product.price_normal));
    let bw = js_math_round(w * 0.34);
    let bh = js_math_round(h * 0.18);
    let bx = inner_x + inner_w - bw - 22.0;
    let by = panel_y + panel_h - bh - 20.0;

    // Code tag (red), right edge, just above the price box.
    if !product.code.is_empty() {
        let tag_w = js_math_round(w * 0.18);
        let tag_h = js_math_round(h * 0.046);
        let tag_x = inner_x + inner_w - tag_w - 22.0;
        let tag_y = by - tag_h - 14.0;
        els.push(Element::Rect { x: tag_x, y: tag_y, w: tag_w, h: tag_h, fill: RED.to_string(), radius: Some(8.0) });
        els.push(Element::Text {
            text: format!("รหัส {}", product.code),
            x: tag_x + tag_w / 2.0,
            y: tag_y + tag_h / 2.0,
            size: js_math_round(tag_h * 0.44),
            color: WHITE.to_string(),
            weight: "bold".to_string(),
            align: "center".to_string(),
            strike: None,
            max_width: Some(tag_w - 12.0),
        });
    }

    // "จำนวนจำกัด" (red, bold, bottom-left of panel).
    els.push(Element::Text {
        text: "จำนวนจำกัด".to_string(),
        x: inner_x + 30.0,
        y: by + bh * 0.32,
        size: js_math_round(w * 0.05),
        color: RED.to_string(),
        weight: "bold".to_string(),
        align: "left".to_string(),
        strike: None,
        max_width: Some(inner_w * 0.5),
    });

    if let Some(price) = price {
        els.push(Element::Rect { x: bx, y: by, w: bw, h: bh, fill: RED.to_string(), radius: Some(18.0) });
        els.push(Element::Rect { x: bx + 8.0, y: by + 8.0, w: bw - 16.0, h: bh - 16.0, fill: WHITE.to_string(), radius: Some(12.0) });
        // Unit label like the real card ("กระปุกละ" / "ขวดละ"); strip "[45เม็ด]" noise.
        let raw_unit = product.unit_text.as_deref().unwrap_or("");
        let stripped = strip_bracketed(&strip_bracketed(raw_unit, '[', ']'), '(', ')');
        let clean_unit = js_trim(&stripped);
        let unit_label = if clean_unit.is_empty() {
            "ราคาพิเศษ".to_string()
        } else {
            format!("{clean_unit}ละ")
        };
        els.push(Element::Text {
            text: unit_label,
            x: bx + bw / 2.0,
            y: by + bh * 0.24,
            size: js_math_round(bh * 0.17),
            color: INK.to_string(),
            weight: "bold".to_string(),
            align: "center".to_string(),
            strike: None,
            max_width: Some(bw - 20.0),
        });
        els.push(Element::Text {
            text: format!("{}.-", money(price)),
            x: bx + bw / 2.0,
            y: by + bh * 0.62,
            size: js_math_round(bh * 0.48),
            color: RED.to_string(),
            weight: "bold".to_string(),
            align: "center".to_string(),
            strike: None,
            max_width: Some(bw - 14.0),
        });
    }

    // ----- bottom gold strip: contact (left) + ส่งฟรี (right) ----------------------
    let strip_y = h - bar_h - p_pad + 2.0;
    let contact = or_str(opts.contact.as_deref(), "สั่งซื้อ/สอบถาม • LINE @cnypharmacy");
    els.push(Element::Text {
        text: contact.to_string(),
        x: inner_x + 8.0,
        y: strip_y + bar_h / 2.0,
        size: js_math_round(bar_h * 0.30),
        color: "#7A1400".to_string(),
        weight: "bold".to_string(),
        align: "left".to_string(),
        strike: None,
        max_width: Some(inner_w * 0.62),
    });
    if opts.ship_free != Some(false) {
        let fw = js_math_round(w * 0.16);
        let fh = js_math_round(bar_h * 0.7);
        let fx = inner_x + inner_w - fw - 8.0;
        let fy = strip_y + (bar_h - fh) / 2.0;
        els.push(Element::Rect { x: fx, y: fy, w: fw, h: fh, fill: "#1B8A3A".to_string(), radius: Some(999.0) });
        els.push(Element::Text {
            text: "🚚 ส่งฟรี".to_string(),
            x: fx + fw / 2.0,
            y: fy + fh / 2.0,
            size: js_math_round(fh * 0.42),
            color: WHITE.to_string(),
            weight: "bold".to_string(),
            align: "center".to_string(),
            strike: None,
            max_width: Some(fw - 10.0),
        });
    }

    DrawPlan { width: w_u, height: h_u, background: GOLD.to_string(), elements: els }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pinned against `node lib/compositor.js` money() — note it differs from
    // the flex-builder money(): it KEEPS "26.60" (no trailing-zero strip) and
    // returns "0" for non-finite input instead of throwing.
    #[test]
    fn compositor_money_edge_cases() {
        assert_eq!(money(731.3299999), "731.33");
        assert_eq!(money(26.6), "26.60"); // flex money() would say "26.6"
        assert_eq!(money(1000.0), "1,000");
        assert_eq!(money(-1234.5), "-1,234.50");
        assert_eq!(money(0.005), "0.01");
        assert_eq!(money(99.995), "100");
        assert_eq!(money(2.675), "2.68");
        assert_eq!(money(f64::NAN), "0");
        assert_eq!(money(f64::INFINITY), "0");
    }

    #[test]
    fn size_fallback_is_square() {
        assert_eq!(size_for(Some("story")), (1080, 1920));
        assert_eq!(size_for(Some("nope")), (1080, 1080));
        assert_eq!(size_for(None), (1080, 1080));
    }

    #[test]
    fn banner_template_promo_delegates_to_promo_card() {
        let p = Product { name: "X".into(), code: "C1".into(), ..Default::default() };
        let opts = CompositorOpts { template: Some("promo".into()), ..Default::default() };
        let plan = build_banner(&p, &opts);
        assert_eq!(plan.background, "#FFC400");
        assert!(plan.elements.iter().any(|e| matches!(e, Element::Burst { .. })));
    }
}
