//! Promotion adapter — port of `lib/promo.js`.
//!
//! Joins CNY active campaigns (`data_promotion_only`) onto catalog products,
//! computing the discounted price + bulk-pack condition text exactly the way
//! the cnypharmacy.com SPA does (prices are NOT stored — computed client-side).
//!
//! Join key: `"{productId}|{unit}"` (the SPA joins on the product's PRIMARY
//! unit only, which is what the flat catalog carries).

use std::collections::HashMap;

use serde_json::{Map, Value};

use crate::flex::builder::{Product, PromoInfo};
pub use crate::flex::builder::money;
use crate::ingest::cny::{is_one, js_string_or_empty, to_n};
use crate::jsutil::{js_math_round, js_string, js_to_number, js_tpl, js_trim, js_truthy};

/// Pull the campaign array out of any catalog/promo API response and index it
/// by `"{productId}|{unit}"`. Skips the "free item" rows of giveaways.
/// Each stored value is the campaign data_product row plus `campaignText`.
pub fn extract_promotions(api_response: &Value) -> HashMap<String, Value> {
    let mut map = HashMap::new();
    let campaigns = api_response
        .get("data_promotion_only")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    for camp in campaigns {
        // Giveaway text lives at campaign level: `camp.text || null`.
        let campaign_text = camp
            .get("text")
            .filter(|v| js_truthy(v))
            .cloned()
            .unwrap_or(Value::Null);
        let products = camp
            .get("data_product")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        for dp in products {
            if is_one(dp.get("is_giveaway")) {
                continue; // the gifted product, not the qualifier
            }
            let key = format!("{}|{}", js_tpl(dp.get("id")), js_tpl(dp.get("unit")));
            if map.contains_key(&key) {
                continue;
            }
            let mut obj: Map<String, Value> = dp.as_object().cloned().unwrap_or_default();
            obj.insert("campaignText".to_string(), campaign_text.clone());
            map.insert(key, Value::Object(obj));
        }
    }
    map
}

/// Flat catalog record + matched campaign -> enriched extension Product.
pub fn promo_to_product(flat: &Value, promo: &Value) -> Product {
    let base = to_n(flat.get("basePrice"));
    let discount = to_n(promo.get("discount"));
    let campaign_text = promo.get("campaignText").filter(|v| js_truthy(v));
    let is_giveaway = promo.get("campaign_type").and_then(Value::as_str) == Some("giveaway")
        || is_one(promo.get("is_giveaway"))
        || campaign_text.is_some();
    let is_percent = promo.get("discount_type").and_then(Value::as_str) == Some("percent");

    let mut price_sale: Option<f64> = None;
    let note: String;
    let mut badge_text = "SPECIAL OFFER";
    let mut badge_color = "#E8000D";

    if is_giveaway && discount == 0.0 {
        note = campaign_text
            .map(js_string)
            .or_else(|| promo.get("campaign_name").filter(|v| js_truthy(v)).map(js_string))
            .unwrap_or_default();
        badge_text = "🎁 ของแถม";
        badge_color = "#27AE60";
    } else if is_percent {
        price_sale = Some(js_math_round(base * (1.0 - discount / 100.0)));
        note = build_condition(promo, discount, true);
    } else {
        price_sale = Some(base - discount);
        note = build_condition(promo, discount, false);
    }

    let valid_sale = price_sale.filter(|&s| s > 0.0 && s < base);

    Product {
        code: js_trim(&js_string_or_empty(flat.get("sku"))).to_string(),
        name: js_trim(&js_string_or_empty(flat.get("name"))).to_string(),
        image_url: js_trim(&js_string_or_empty(flat.get("image"))).to_string(),
        price_normal: (base > 0.0).then_some(base),
        price_sale: valid_sale,
        // badge overridden to SPECIAL OFFER; "ราคาพิเศษ" reads better than
        // "Flash Sale" for bulk promos.
        promo_type: "custom".to_string(),
        badge_text: Some(badge_text.to_string()),
        badge_color: Some(badge_color.to_string()),
        note: Some(note),
        unit_text: Some(
            promo
                .get("unit")
                .filter(|v| js_truthy(v))
                .or_else(|| flat.get("unit").filter(|v| js_truthy(v)))
                .map(js_string)
                .unwrap_or_default(),
        ),
        tags: Some(
            std::iter::once("promotion".to_string())
                .chain(
                    flat.get("tags")
                        .and_then(Value::as_array)
                        .map(|a| a.iter().map(js_string).collect::<Vec<_>>())
                        .unwrap_or_default(),
                )
                .collect(),
        ),
        promo: Some(PromoInfo {
            qty: promo
                .get("qty")
                .filter(|v| !v.is_null())
                .map(js_to_number),
            unit: promo
                .get("unit")
                .filter(|v| !v.is_null())
                .map(js_string),
            discount,
            kind: if is_giveaway {
                "giveaway"
            } else if is_percent {
                "percent"
            } else {
                "baht"
            }
            .to_string(),
            is_buy_pack: is_one(promo.get("is_buy_pack")),
            campaign_name: js_string_or_empty(promo.get("campaign_name")),
            ends_at: promo
                .get("end_pro")
                .filter(|v| js_truthy(v))
                .map(js_string),
        }),
        ..Default::default()
    }
}

/// Build the "ซื้อยกแพ็ค …" / "ซื้อ … ขึ้นไป …" condition line the SPA renders.
fn build_condition(dp: &Value, discount: f64, is_percent: bool) -> String {
    let qty = js_tpl(dp.get("qty"));
    let unit = js_string_or_empty(dp.get("unit"));
    if is_one(dp.get("is_buy_pack")) {
        let lead = format!("ซื้อยกแพ็ค {qty} {unit}");
        let tail = if is_percent {
            format!("ลดเพิ่ม {}%", money(discount))
        } else {
            let qty_n = dp.get("qty").map(js_to_number).unwrap_or(f64::NAN);
            format!("ลดเพิ่มแพ็คละ {} บาท", money(js_math_round(qty_n * discount)))
        };
        format!("{lead} {tail}")
    } else {
        let lead = format!("ซื้อ {qty} {unit} ขึ้นไป");
        let tail = if is_percent {
            format!("ลด {}%", money(discount))
        } else {
            format!("ลด{unit} ละ {} บาท", money(discount))
        };
        format!("{lead} {tail}")
    }
}

/// Catalog flats + campaign map -> only the products that have an active promo.
pub fn build_promo_products(flats: &[Value], promo_map: &HashMap<String, Value>) -> Vec<Product> {
    let mut out = vec![];
    for f in flats {
        let key = format!("{}|{}", js_tpl(f.get("productId")), js_tpl(f.get("unit")));
        let Some(promo) = promo_map.get(&key) else { continue };
        let p = promo_to_product(f, promo);
        if !p.code.is_empty() && !p.name.is_empty() && is_https(&p.image_url) {
            out.push(p);
        }
    }
    out
}

fn is_https(url: &str) -> bool {
    url.len() >= 8 && url.as_bytes()[..8].eq_ignore_ascii_case(b"https://")
}
