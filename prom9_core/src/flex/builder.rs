//! Flex Builder — port of `lib/flex-builder.js`.
//!
//! Turns a [`Product`] + promo preset into a LINE Flex bubble, then assembles
//! bubbles into carousels and message envelopes. Output is `serde_json::Value`
//! with exactly the same key set as the JS builder (conditional fields are
//! omitted, never `null`), so it compares equal to the golden fixtures.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::jsutil::{
    group_thousands, js_math_round, js_num_to_string, js_trim, strip_bracketed, utf16_len,
    utf16_slice_to,
};

pub const MAX_BUBBLES: usize = 12;

// SPECIAL PROMO card palette (matches the compositor banner / cnypharmacy card).
const GOLD: &str = "#FFC400";
const PROMO_RED: &str = "#E2001A";
const INK: &str = "#1A1A1A";

// bigprice / minimal / urgent template palette.
const SALE_RED: &str = "#E8000D";
const MINIMAL_BLUE: &str = "#002689";
const URGENT_DARK: &str = "#7A0010";

/// The internal Product schema shared by the builder, the ingest adapters and
/// the compositor (see `lib/adapters.js` header comment).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Product {
    pub code: String,
    pub name: String,
    pub image_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_normal: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_sale: Option<f64>,
    pub promo_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub badge_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub badge_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expire_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stock_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub points_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_text: Option<String>,
    #[serde(rename = "_tags", skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(rename = "_promo", skip_serializing_if = "Option::is_none")]
    pub promo: Option<PromoInfo>,
}

/// `_promo` metadata attached by the promotion adapter (`lib/promo.js`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PromoInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qty: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    pub discount: f64,
    /// "percent" | "baht" | "giveaway"
    #[serde(rename = "type")]
    pub kind: String,
    pub is_buy_pack: bool,
    pub campaign_name: String,
    /// Always serialized (the JS adapter stores `end_pro || null`).
    pub ends_at: Option<String>,
}

/// Visual template for a bubble. Unknown template names fall back to
/// `Classic`, exactly like `TEMPLATE_BUILDERS[opts.template] || classicBubble`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Template {
    #[default]
    Classic,
    Promo,
    #[serde(rename = "bigprice")]
    BigPrice,
    Minimal,
    Urgent,
}

impl Template {
    /// Parse a template name; anything unknown maps to `Classic`.
    pub fn parse(name: &str) -> Template {
        match name {
            "promo" => Template::Promo,
            "bigprice" => Template::BigPrice,
            "minimal" => Template::Minimal,
            "urgent" => Template::Urgent,
            _ => Template::Classic,
        }
    }
}

/// preset -> badge text + color (`PRESETS` in flex-builder.js).
pub fn preset(promo_type: &str) -> Option<(&'static str, &'static str)> {
    match promo_type {
        "flash" => Some(("⚡ FLASH SALE", "#E8000D")),
        "lastlot" => Some(("🔥 ล็อตสุดท้ายก่อนปรับราคา", "#C0392B")),
        "member" => Some(("💎 ราคาสมาชิก", "#8E44AD")),
        "custom" => Some(("โปรพิเศษ", "#333333")),
        _ => None,
    }
}

// preset -> the label used on the sale-price line (classic template).
fn sale_label(promo_type: &str) -> &'static str {
    match promo_type {
        "flash" => "ราคา Flash Sale",
        "lastlot" => "ราคาล็อตสุดท้าย",
        "member" => "ราคาสมาชิก",
        _ => "ราคาพิเศษ", // custom
    }
}

// preset -> an automatic supporting line (classic template).
fn preset_note(promo_type: &str) -> Option<&'static str> {
    match promo_type {
        "lastlot" => Some("⚠️ จำนวนจำกัด ล็อตสุดท้ายก่อนปรับราคา"),
        "member" => Some("✨ สมัครสมาชิกวันนี้รับราคาพิเศษ"),
        _ => None,
    }
}

// ---- public -----------------------------------------------------------------

/// Build one bubble in the given template.
pub fn build_bubble(product: &Product, template: Template) -> Value {
    match template {
        Template::Classic => classic_bubble(product),
        Template::Promo => promo_bubble(product),
        Template::BigPrice => big_price_bubble(product),
        Template::Minimal => minimal_bubble(product),
        Template::Urgent => urgent_bubble(product),
    }
}

/// Build a carousel; errors above [`MAX_BUBBLES`] with the same message the
/// JS builder throws.
pub fn build_carousel(products: &[Product], template: Template) -> Result<Value, String> {
    if products.len() > MAX_BUBBLES {
        return Err(format!(
            "carousel รับได้สูงสุด {} bubble (ได้รับ {})",
            MAX_BUBBLES,
            products.len()
        ));
    }
    Ok(json!({
        "type": "carousel",
        "contents": products.iter().map(|p| build_bubble(p, template)).collect::<Vec<_>>(),
    }))
}

/// Auto-split into multiple carousels of <= 12 bubbles (never errors).
pub fn build_carousels(products: &[Product], template: Template) -> Vec<Value> {
    products
        .chunks(MAX_BUBBLES)
        .map(|chunk| build_carousel(chunk, template).expect("chunk size <= MAX_BUBBLES"))
        .collect()
}

/// Wrap a carousel in the Messaging API flex envelope.
/// `None` / `Some("")` both fall back to the default alt text (JS `||`).
pub fn build_flex_message(carousel: &Value, alt_text: Option<&str>) -> Value {
    let alt = match alt_text {
        Some(s) if !s.is_empty() => s,
        _ => "โปรโมชั่นสินค้า",
    };
    json!({
        "type": "flex",
        "altText": alt,
        "contents": carousel,
    })
}

/// `money(n)`: thousand-separated, two decimals max, drops ".00" and one
/// trailing zero, taming binary float drift exactly like
/// `Math.round(n * 100) / 100` + `toFixed(2)` (e.g. `731.3299999` -> "731.33",
/// `26.6` -> "26.6", `1000` -> "1,000").
pub fn money(n: f64) -> String {
    let cents_f = js_math_round(n * 100.0);
    if !cents_f.is_finite() {
        // The JS version throws a TypeError here (`undefined.replace`); we
        // return the stringified value instead of panicking.
        return js_num_to_string(cents_f);
    }
    let neg = cents_f < 0.0;
    let abs = cents_f.abs().min(i128::MAX as f64) as i128;
    let int_part = abs / 100;
    let dec = (abs % 100) as u8;
    let mut grouped = group_thousands(&int_part.to_string());
    if neg {
        grouped.insert(0, '-');
    }
    if dec == 0 {
        return grouped;
    }
    let mut dd = format!("{dec:02}");
    if dd.ends_with('0') {
        dd.pop(); // `.replace(/0$/, '')`
    }
    format!("{grouped}.{dd}")
}

// ---- template builders --------------------------------------------------------

// The cnypharmacy "SPECIAL PROMO" card style.
fn promo_bubble(p: &Product) -> Value {
    let badge_text = non_empty(p.badge_text.as_deref()).unwrap_or("SPECIAL PROMO");
    let badge_color = non_empty(p.badge_color.as_deref()).unwrap_or(PROMO_RED);

    let price = num(p.price_sale).or_else(|| num(p.price_normal));
    let clean_unit = clean_unit(p.unit_text.as_deref());
    let unit_label = if clean_unit.is_empty() {
        "ราคาพิเศษ".to_string()
    } else {
        format!("{clean_unit}ละ")
    };

    // White product panel: name + image + (code tag).
    let mut panel = vec![
        text(&p.name, &[("weight", json!("bold")), ("size", json!("sm")), ("color", json!(INK)), ("wrap", json!(true)), ("align", json!("center"))]),
        json!({ "type": "image", "url": p.image_url, "size": "full", "aspectRatio": "1:1", "aspectMode": "fit", "margin": "sm" }),
    ];
    if let Some(code) = non_empty_str(&p.code) {
        panel.push(pill_right(&format!("รหัส {code}"), PROMO_RED, "#FFFFFF"));
    }

    // Price row: "จำนวนจำกัด" (left) + white price box with red border (right).
    let price_text = match price {
        Some(v) => format!("{}.-", money(v)),
        None => "—".to_string(),
    };
    let price_row = json!({
        "type": "box", "layout": "horizontal", "alignItems": "center", "margin": "md", "spacing": "sm",
        "contents": [
            text("จำนวนจำกัด", &[("weight", json!("bold")), ("size", json!("sm")), ("color", json!(PROMO_RED)), ("gravity", json!("center")), ("flex", json!(4)), ("wrap", json!(true))]),
            {
                "type": "box", "layout": "vertical", "flex": 5, "backgroundColor": "#FFFFFF",
                "borderColor": PROMO_RED, "borderWidth": "2px", "cornerRadius": "8px", "paddingAll": "5px",
                "contents": [
                    text(&unit_label, &[("size", json!("xxs")), ("color", json!(INK)), ("align", json!("center"))]),
                    text(&price_text, &[("weight", json!("bold")), ("size", json!("xxl")), ("color", json!(PROMO_RED)), ("align", json!("center"))]),
                ],
            },
        ],
    });

    let mut body_contents = vec![
        promo_badge(badge_text, badge_color),
        json!({ "type": "box", "layout": "vertical", "backgroundColor": "#FFFFFF", "cornerRadius": "10px", "paddingAll": "8px", "spacing": "sm", "contents": panel }),
        price_row,
    ];
    if let Some(note) = non_empty(p.note.as_deref()) {
        body_contents.push(text(note, &[("size", json!("xxs")), ("color", json!("#7A1400")), ("wrap", json!(true)), ("align", json!("center")), ("margin", json!("sm"))]));
    }
    body_contents.push(ship_free_pill());

    json!({
        "type": "bubble",
        "body": {
            "type": "box", "layout": "vertical", "backgroundColor": GOLD, "paddingAll": "10px", "spacing": "sm",
            "contents": body_contents,
        },
        "footer": {
            "type": "box", "layout": "vertical", "backgroundColor": GOLD, "paddingAll": "10px",
            "contents": [{
                "type": "button", "style": "primary", "color": PROMO_RED, "height": "sm",
                "action": { "type": "message", "label": cta_label(&p.code), "text": format!("สนใจ รหัส {}", p.code) },
            }],
        },
    })
}

// The original bubble layout.
fn classic_bubble(p: &Product) -> Value {
    let promo_type = if preset(&p.promo_type).is_some() {
        p.promo_type.as_str()
    } else {
        "custom"
    };
    let (preset_badge, preset_color) = preset(promo_type).expect("valid preset");
    let badge_text = non_empty(p.badge_text.as_deref()).unwrap_or(preset_badge);
    let badge_color = non_empty(p.badge_color.as_deref()).unwrap_or(preset_color);

    let mut body = vec![
        badge_box(badge_text, badge_color),
        text(&p.name, &[("weight", json!("bold")), ("size", json!("lg")), ("color", json!("#d70f0f")), ("wrap", json!(true)), ("margin", json!("sm"))]),
    ];
    body.extend(price_lines(p, promo_type, badge_color));

    if let Some(note) = preset_note(promo_type) {
        body.push(text(note, &[("size", json!("xs")), ("color", json!(badge_color)), ("margin", json!("sm"))]));
    }

    let mut first = true;
    let supports: [(Option<&str>, &str); 4] = [
        (p.expire_text.as_deref(), badge_color),
        (p.stock_text.as_deref(), "#999999"),
        (p.points_text.as_deref(), "#27AE60"),
        (p.note.as_deref(), "#999999"),
    ];
    for (value, color) in supports {
        let Some(value) = non_empty(value) else { continue };
        let mut opts = vec![("size", json!("xs")), ("color", json!(color)), ("wrap", json!(true))];
        if first {
            opts.push(("margin", json!("sm")));
        }
        body.push(text(value, &opts));
        first = false;
    }

    json!({
        "type": "bubble",
        "hero": { "type": "image", "url": p.image_url, "size": "full", "aspectRatio": "1:1", "aspectMode": "cover" },
        "body": { "type": "box", "layout": "vertical", "contents": body },
        "footer": {
            "type": "box", "layout": "vertical",
            "contents": [{
                "type": "button", "style": "primary", "color": badge_color,
                "action": { "type": "message", "label": cta_label(&p.code), "text": format!("สนใจ รหัส {}", p.code) },
            }],
        },
    })
}

// ราคาเด่น: huge red sale price, struck normal, % chip.
fn big_price_bubble(p: &Product) -> Value {
    let normal = num(p.price_normal);
    let sale = num(p.price_sale);
    let has_discount = matches!((normal, sale), (Some(n), Some(s)) if n > s);
    let price = sale.or(normal);

    let mut body = vec![text(&p.name, &[("size", json!("sm")), ("color", json!("#555555")), ("wrap", json!(true)), ("align", json!("center"))])];
    if has_discount {
        body.push(text(
            &format!("ปกติ ฿{}", money(normal.expect("has_discount"))),
            &[("size", json!("sm")), ("color", json!("#999999")), ("decoration", json!("line-through")), ("align", json!("center")), ("margin", json!("md"))],
        ));
    }
    let price_text = match price {
        Some(v) => format!("฿{}", money(v)),
        None => "สอบถามราคา".to_string(),
    };
    body.push(text(&price_text, &[
        ("weight", json!("bold")), ("size", json!("xxl")), ("color", json!(SALE_RED)), ("align", json!("center")),
        ("margin", json!(if has_discount { "xs" } else { "md" })),
    ]));
    if has_discount {
        let (n, s) = (normal.expect("has_discount"), sale.expect("has_discount"));
        let pct = js_math_round((1.0 - s / n) * 100.0);
        if pct > 0.0 {
            body.push(pill_center(&format!("ลด {}%", js_num_to_string(pct)), SALE_RED, "#FFFFFF"));
        }
    }
    if let Some(code) = non_empty_str(&p.code) {
        body.push(text(&format!("รหัส {code}"), &[("size", json!("xxs")), ("color", json!("#BBBBBB")), ("align", json!("center")), ("margin", json!("md"))]));
    }

    json!({
        "type": "bubble",
        "hero": { "type": "image", "url": p.image_url, "size": "full", "aspectRatio": "1:1", "aspectMode": "cover" },
        "body": { "type": "box", "layout": "vertical", "backgroundColor": "#FFFFFF", "paddingAll": "16px", "contents": body },
    })
}

// มินิมอลสะอาด: big hero (fit), name, thin separator, blue price row.
fn minimal_bubble(p: &Product) -> Value {
    let price = num(p.price_sale).or_else(|| num(p.price_normal));
    let clean_unit = clean_unit(p.unit_text.as_deref());

    let unit_line = if clean_unit.is_empty() {
        "ราคา".to_string()
    } else {
        format!("ราคา / {clean_unit}")
    };
    let price_text = match price {
        Some(v) => format!("฿{}", money(v)),
        None => "—".to_string(),
    };

    json!({
        "type": "bubble",
        "hero": {
            "type": "image", "url": p.image_url, "size": "full",
            "aspectRatio": "1:1", "aspectMode": "fit", "backgroundColor": "#FFFFFF",
        },
        "body": {
            "type": "box", "layout": "vertical", "backgroundColor": "#FFFFFF", "paddingAll": "20px",
            "contents": [
                text(&p.name, &[("weight", json!("bold")), ("size", json!("md")), ("color", json!(INK)), ("wrap", json!(true))]),
                { "type": "separator", "margin": "lg", "color": "#E6EAF2" },
                {
                    "type": "box", "layout": "horizontal", "margin": "lg", "alignItems": "center",
                    "contents": [
                        text(&unit_line, &[("size", json!("xs")), ("color", json!("#8A93A6")), ("gravity", json!("center")), ("flex", json!(3))]),
                        text(&price_text, &[("weight", json!("bold")), ("size", json!("xl")), ("color", json!(MINIMAL_BLUE)), ("align", json!("end")), ("flex", json!(4))]),
                    ],
                },
            ],
        },
    })
}

// เร่งด่วน: dark-red countdown strip + red CTA box.
fn urgent_bubble(p: &Product) -> Value {
    let ends_at = p
        .promo
        .as_ref()
        .and_then(|pr| pr.ends_at.as_deref())
        .and_then(|s| non_empty(Some(s)));
    let strip_text = match ends_at {
        Some(e) => format!("⏰ ด่วน! โปรหมดเร็ว ถึง {e}"),
        None => "⏰ ด่วน! โปรหมดเร็ว".to_string(),
    };
    let normal = num(p.price_normal);
    let sale = num(p.price_sale);
    let price = sale.or(normal);

    let mut info = vec![text(&p.name, &[("weight", json!("bold")), ("size", json!("md")), ("color", json!(INK)), ("wrap", json!(true))])];
    if let (Some(n), Some(s)) = (normal, sale) {
        if n > s {
            info.push(text(
                &format!("ราคาปกติ ฿{}", money(n)),
                &[("size", json!("sm")), ("color", json!("#999999")), ("decoration", json!("line-through")), ("margin", json!("sm"))],
            ));
        }
    }
    let price_text = match price {
        Some(v) => format!("฿{}", money(v)),
        None => "สอบถามราคา".to_string(),
    };
    info.push(text(&price_text, &[("weight", json!("bold")), ("size", json!("xxl")), ("color", json!(SALE_RED)), ("margin", json!("xs"))]));
    if let Some(note) = non_empty(p.note.as_deref()) {
        info.push(text(note, &[("size", json!("xs")), ("color", json!("#7A1400")), ("wrap", json!(true)), ("margin", json!("sm"))]));
    }

    let footer_text = match non_empty_str(&p.code) {
        Some(code) => format!("สนใจ ทักเลย! รหัส {code}"),
        None => "สนใจ ทักแชทเลย!".to_string(),
    };

    json!({
        "type": "bubble",
        "body": {
            "type": "box", "layout": "vertical", "paddingAll": "0px",
            "contents": [
                {
                    "type": "box", "layout": "vertical", "backgroundColor": URGENT_DARK, "paddingAll": "8px",
                    "contents": [text(&strip_text, &[("weight", json!("bold")), ("size", json!("sm")), ("color", json!("#FFFFFF")), ("align", json!("center")), ("wrap", json!(true))])],
                },
                { "type": "image", "url": p.image_url, "size": "full", "aspectRatio": "1:1", "aspectMode": "cover" },
                { "type": "box", "layout": "vertical", "paddingAll": "12px", "contents": info },
            ],
        },
        "footer": {
            "type": "box", "layout": "vertical", "backgroundColor": SALE_RED, "paddingAll": "10px",
            "contents": [text(&footer_text, &[("weight", json!("bold")), ("size", json!("sm")), ("color", json!("#FFFFFF")), ("align", json!("center")), ("wrap", json!(true))])],
        },
    })
}

// ---- internals ------------------------------------------------------------

fn price_lines(p: &Product, promo_type: &str, sale_color: &str) -> Vec<Value> {
    let normal = num(p.price_normal);
    let sale = num(p.price_sale);
    let mut lines = vec![];

    match (normal, sale) {
        (Some(n), Some(s)) => {
            lines.push(text(
                &format!("ราคาปกติ ฿{}", money(n)),
                &[("size", json!("sm")), ("color", json!("#999999")), ("decoration", json!("line-through")), ("margin", json!("sm"))],
            ));
            lines.push(text(
                &format!("{} ฿{}", sale_label(promo_type), money(s)),
                &[("weight", json!("bold")), ("size", json!("md")), ("color", json!(sale_color))],
            ));
            let save = n - s;
            if save > 0.0 {
                lines.push(text(&format!("ประหยัด ฿{}", money(save)), &[("size", json!("sm")), ("color", json!("#27AE60"))]));
            }
        }
        (None, Some(s)) => {
            lines.push(text(
                &format!("{} ฿{}", sale_label(promo_type), money(s)),
                &[("weight", json!("bold")), ("size", json!("md")), ("color", json!(sale_color)), ("margin", json!("sm"))],
            ));
        }
        (Some(n), None) => {
            lines.push(text(
                &format!("ราคา ฿{}", money(n)),
                &[("weight", json!("bold")), ("size", json!("md")), ("color", json!(sale_color)), ("margin", json!("sm"))],
            ));
        }
        (None, None) => {}
    }
    lines
}

fn badge_box(badge_text: &str, badge_color: &str) -> Value {
    json!({
        "type": "box",
        "layout": "vertical",
        "backgroundColor": badge_color,
        "paddingAll": "4px",
        "contents": [
            text(badge_text, &[("weight", json!("bold")), ("size", json!("sm")), ("color", json!("#FFFFFF")), ("align", json!("center"))]),
        ],
    })
}

// Left-aligned red promo badge (yellow text).
fn promo_badge(badge_text: &str, color: &str) -> Value {
    json!({
        "type": "box", "layout": "horizontal",
        "contents": [
            {
                "type": "box", "layout": "vertical", "flex": 0, "backgroundColor": color, "cornerRadius": "6px",
                "paddingAll": "4px", "paddingStart": "10px", "paddingEnd": "10px",
                "contents": [text(badge_text, &[("weight", json!("bold")), ("size", json!("xs")), ("color", json!("#FFE000")), ("align", json!("center"))])],
            },
            { "type": "filler" },
        ],
    })
}

// A right-hugging coloured pill (the "รหัส XXXX" tag).
fn pill_right(label: &str, bg: &str, fg: &str) -> Value {
    json!({
        "type": "box", "layout": "horizontal",
        "contents": [
            { "type": "filler" },
            {
                "type": "box", "layout": "vertical", "flex": 0, "backgroundColor": bg, "cornerRadius": "6px",
                "paddingAll": "2px", "paddingStart": "8px", "paddingEnd": "8px",
                "contents": [text(label, &[("size", json!("xxs")), ("color", json!(fg)), ("align", json!("center"))])],
            },
        ],
    })
}

// A centered coloured pill (the discount % chip).
fn pill_center(label: &str, bg: &str, fg: &str) -> Value {
    json!({
        "type": "box", "layout": "horizontal", "margin": "sm",
        "contents": [
            { "type": "filler" },
            {
                "type": "box", "layout": "vertical", "flex": 0, "backgroundColor": bg, "cornerRadius": "999px",
                "paddingAll": "3px", "paddingStart": "12px", "paddingEnd": "12px",
                "contents": [text(label, &[("weight", json!("bold")), ("size", json!("xs")), ("color", json!(fg)), ("align", json!("center"))])],
            },
            { "type": "filler" },
        ],
    })
}

// Centered green "ส่งฟรี" pill.
fn ship_free_pill() -> Value {
    json!({
        "type": "box", "layout": "horizontal", "margin": "sm",
        "contents": [
            { "type": "filler" },
            {
                "type": "box", "layout": "vertical", "flex": 0, "backgroundColor": "#1B8A3A", "cornerRadius": "999px",
                "paddingAll": "3px", "paddingStart": "12px", "paddingEnd": "12px",
                "contents": [text("🚚 ส่งฟรี", &[("size", json!("xxs")), ("color", json!("#FFFFFF")), ("align", json!("center"))])],
            },
            { "type": "filler" },
        ],
    })
}

fn text(value: &str, opts: &[(&str, Value)]) -> Value {
    let mut m = Map::new();
    m.insert("type".to_string(), json!("text"));
    m.insert("text".to_string(), json!(value));
    for (k, v) in opts {
        m.insert((*k).to_string(), v.clone());
    }
    Value::Object(m)
}

// LINE caps button action labels at 20 chars (UTF-16 units, like JS .length).
fn cta_label(code: &str) -> String {
    let label = format!("สนใจ รหัส {code}");
    if utf16_len(&label) <= 20 {
        label
    } else {
        utf16_slice_to(&label, 20)
    }
}

/// `isNum`: a finite number.
fn num(v: Option<f64>) -> Option<f64> {
    v.filter(|x| x.is_finite())
}

/// `nonEmpty`: present and not whitespace-only; returns the ORIGINAL
/// (untrimmed) value like the JS helper.
fn non_empty(v: Option<&str>) -> Option<&str> {
    v.filter(|s| !js_trim(s).is_empty())
}

fn non_empty_str(s: &str) -> Option<&str> {
    non_empty(Some(s))
}

/// `String(unitText || '').replace(/\[.*?\]/g,'').replace(/\(.*?\)/g,'').trim()`
fn clean_unit(unit_text: Option<&str>) -> String {
    let raw = unit_text.unwrap_or("");
    let s = strip_bracketed(raw, '[', ']');
    let s = strip_bracketed(&s, '(', ')');
    js_trim(&s).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pinned against node: lib/promo.js money() (identical source to the
    // flex-builder internal money()).
    #[test]
    fn money_edge_cases() {
        assert_eq!(money(731.3299999), "731.33"); // float-edge golden case
        assert_eq!(money(26.6699999), "26.67");
        assert_eq!(money(1234567.891), "1,234,567.89");
        assert_eq!(money(26.6), "26.6"); // strips ONE trailing zero
        assert_eq!(money(1000.0), "1,000"); // drops ".00"
        assert_eq!(money(0.005), "0.01");
        assert_eq!(money(-1234.5), "-1,234.5");
        assert_eq!(money(0.1 + 0.2), "0.3");
        assert_eq!(money(99.995), "100"); // 99.995*100 lands on 9999.5, ties up
        assert_eq!(money(2.675), "2.68"); // 2.675*100 rounds to 267.5 in f64, like JS
        assert_eq!(money(-0.001), "0");
        assert_eq!(money(1_000_000_000.5), "1,000,000,000.5");
        assert_eq!(money(0.0), "0");
    }

    #[test]
    fn cta_label_slices_at_20_utf16_units() {
        assert_eq!(cta_label("A100"), "สนใจ รหัส A100");
        assert_eq!(cta_label("LONGCODE123456"), "สนใจ รหัส LONGCODE12");
    }

    #[test]
    fn carousel_overflow_errors_like_js() {
        let p = Product {
            code: "X".into(),
            name: "x".into(),
            image_url: "https://example.com/p.jpg".into(),
            price_normal: Some(1.0),
            promo_type: "flash".into(),
            ..Default::default()
        };
        let thirteen = vec![p; 13];
        let err = build_carousel(&thirteen, Template::Classic).unwrap_err();
        assert_eq!(err, "carousel รับได้สูงสุด 12 bubble (ได้รับ 13)");
        assert_eq!(
            build_carousels(&thirteen, Template::Classic)
                .iter()
                .map(|c| c["contents"].as_array().unwrap().len())
                .collect::<Vec<_>>(),
            vec![12, 1]
        );
    }

    #[test]
    fn unknown_template_falls_back_to_classic() {
        let p = Product { name: "n".into(), ..Default::default() };
        assert_eq!(Template::parse("weird"), Template::Classic);
        assert_eq!(
            build_bubble(&p, Template::parse("weird")),
            build_bubble(&p, Template::Classic)
        );
    }
}
