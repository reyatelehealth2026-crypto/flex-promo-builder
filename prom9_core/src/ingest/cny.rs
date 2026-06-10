//! CNY catalog adapter — port of `lib/cny.js`.
//!
//! Flattens raw cnypharmacy API pages (or a cached snapshot) and maps them
//! into the [`Product`] schema. Raw API data stays `serde_json::Value` so the
//! JS coercion rules survive messy payloads (string prices, numeric SKUs, ...).

use std::collections::HashSet;

use serde_json::{json, Value};

use crate::flex::builder::Product;
use crate::jsutil::{js_num_to_string, js_string, js_to_number, js_trim, js_truthy};

pub const CNY_API: &str = "https://www.cnypharmacy.com/api/getDataProductIsGroup";
const CNY_IMG: &str = "https://manager.cnypharmacy.com";
const CNY_BASE: &str = "https://www.cnypharmacy.com";

pub fn cny_page_url(page: i64, paginate: i64) -> String {
    format!("{CNY_API}?page={page}&paginate_num={paginate}&isPageGroup=")
}

/// `toN`: null/undefined -> 0, else `Number(v)` (non-finite -> 0).
pub(crate) fn to_n(v: Option<&Value>) -> f64 {
    match v {
        None | Some(Value::Null) => 0.0,
        Some(x) => {
            let n = js_to_number(x);
            if n.is_finite() {
                n
            } else {
                0.0
            }
        }
    }
}

/// strict `=== 1` (numbers only).
pub(crate) fn is_one(v: Option<&Value>) -> bool {
    v.and_then(Value::as_f64) == Some(1.0)
}

/// `flat.x || ''` then `String(...)`: truthy value stringified, else "".
pub(crate) fn js_string_or_empty(v: Option<&Value>) -> String {
    v.filter(|v| js_truthy(v)).map(js_string).unwrap_or_default()
}

/// Port of refresh-cache.cjs flatten(): one raw API item -> flat record + tags.
pub fn flatten_cny_item(it: &Value) -> Value {
    let empty = json!({});
    let d = it.pointer("/product_data/0").filter(|v| js_truthy(v)).unwrap_or(&empty);
    let pi = it
        .pointer("/product_price/0/product_price/0")
        .filter(|v| js_truthy(v))
        .unwrap_or(&empty);
    let photo = it
        .pointer("/product_photo/0/photo_path")
        .filter(|v| js_truthy(v))
        .map(js_string);
    let unit = it
        .pointer("/product_unit/0/unit")
        .filter(|v| js_truthy(v))
        .cloned()
        .unwrap_or(json!(""));
    let base_price = to_n(pi.get("price"));
    let promo_raw = to_n(pi.get("promotion_price"));
    let promotion_price = if promo_raw > 0.0 && promo_raw < base_price {
        json!(promo_raw)
    } else {
        Value::Null
    };
    let stock: f64 = it
        .get("product_stock")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|x| to_n(x.get("stock_num"))).sum())
        .unwrap_or(0.0);

    let mut tags: Vec<Value> = vec![];
    if is_one(d.get("is_promotion")) {
        tags.push(json!("promotion"));
    }
    if is_one(it.get("product_is_flashSale")) {
        tags.push(json!("flash_sale"));
    }
    let customer_buyed = it
        .get("customer_buyed")
        .filter(|v| !v.is_null())
        .map(js_to_number)
        .unwrap_or(0.0);
    if is_one(d.get("is_bestseller")) || customer_buyed > 0.0 {
        tags.push(json!("bestseller"));
    }
    if is_one(d.get("is_recommend")) || is_one(it.get("product_is_recommend")) {
        tags.push(json!("new_arrival"));
    }

    let sku = d.get("sku").filter(|v| js_truthy(v)).cloned().unwrap_or(json!(""));
    let product_id = d.get("id").filter(|v| js_truthy(v)).cloned().unwrap_or(Value::Null);

    json!({
        "sku": sku,
        "productId": product_id,
        "name": d.get("name").filter(|v| js_truthy(v)).cloned().unwrap_or(json!("")),
        "nameEn": js_trim(&js_string_or_empty(d.get("name_en"))),
        "specName": js_trim(&js_string_or_empty(d.get("spec_name"))),
        "image": match photo {
            Some(p) => format!("{CNY_IMG}/{p}"),
            None => format!("{CNY_IMG}/uploads/product_photo/placeholder.jpg"),
        },
        "url": if js_truthy(&sku) {
            format!("{CNY_BASE}/product/{}", js_string(&sku))
        } else {
            CNY_BASE.to_string()
        },
        "basePrice": base_price,
        "promotionPrice": promotion_price,
        "unit": unit,
        "stock": stock,
        "isPrescription": is_one(it.get("is_rx")),
        "tags": tags,
    })
}

/// Raw API pages (page objects or item arrays) -> deduped flat\[] (by productId).
pub fn flatten_cny_pages(pages: &[Value]) -> Vec<Value> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = vec![];
    for page in pages {
        let empty = vec![];
        let items: &Vec<Value> = if let Some(a) = page.as_array() {
            a
        } else {
            page.get("product").and_then(Value::as_array).unwrap_or(&empty)
        };
        for it in items {
            let flat = flatten_cny_item(it);
            if !js_truthy(&flat["sku"]) || !js_truthy(&flat["productId"]) {
                continue;
            }
            // Serialize the id so number 1 and string "1" stay distinct,
            // like a JS Set of mixed values.
            let key = serde_json::to_string(&flat["productId"]).unwrap_or_default();
            if !seen.insert(key) {
                continue;
            }
            out.push(flat);
        }
    }
    out
}

/// Flat record -> extension Product. Sale items default to the "flash" preset;
/// tags are kept on `_tags` for client-side theme filtering.
pub fn cny_to_product(flat: &Value) -> Product {
    let base_price = to_n(flat.get("basePrice"));
    let promo = flat.get("promotionPrice").filter(|v| !v.is_null());
    let price_normal = (base_price > 0.0).then_some(base_price);
    let price_sale = promo.map(|p| to_n(Some(p))).filter(|&v| v > 0.0);
    let stock = to_n(flat.get("stock"));

    Product {
        code: js_trim(&js_string_or_empty(flat.get("sku"))).to_string(),
        name: js_trim(&js_string_or_empty(flat.get("name"))).to_string(),
        image_url: js_trim(&js_string_or_empty(flat.get("image"))).to_string(),
        price_normal,
        price_sale,
        promo_type: if price_sale.is_some() { "flash" } else { "custom" }.to_string(),
        stock_text: (stock > 0.0 && stock <= 10.0)
            .then(|| format!("🔥 เหลือ {} ชิ้น", js_num_to_string(stock))),
        unit_text: Some(js_trim(&js_string_or_empty(flat.get("unit"))).to_string()),
        tags: Some(
            flat.get("tags")
                .and_then(Value::as_array)
                .map(|a| a.iter().map(js_string).collect())
                .unwrap_or_default(),
        ),
        ..Default::default()
    }
}

/// Accepts raw API page(s), a cached snapshot, or a flat\[] array.
pub fn normalize_from_cny(input: &Value) -> Vec<Product> {
    let owned: Vec<Value>;
    let flats: &[Value] = if input
        .as_array()
        .and_then(|a| a.first())
        .is_some_and(|first| first.get("product_data").is_some())
    {
        owned = flatten_cny_pages(std::slice::from_ref(input)); // array of raw API items
        &owned
    } else if input.get("product").is_some_and(js_truthy) {
        owned = flatten_cny_pages(std::slice::from_ref(input)); // single raw API page object
        &owned
    } else if let Some(a) = input.as_array() {
        a // pre-flattened snapshot array
    } else if let Some(a) = input.pointer("/products").and_then(Value::as_array) {
        a // cached snapshot { products: [...] }
    } else {
        &[]
    };

    flats
        .iter()
        .map(cny_to_product)
        .filter(|p| !p.code.is_empty() && !p.name.is_empty() && is_https(&p.image_url))
        .collect()
}

/// String input variant.
pub fn normalize_from_cny_str(input: &str) -> Result<Vec<Product>, String> {
    let data: Value = serde_json::from_str(input).map_err(|e| e.to_string())?;
    Ok(normalize_from_cny(&data))
}

fn is_https(url: &str) -> bool {
    url.len() >= 8 && url.as_bytes()[..8].eq_ignore_ascii_case(b"https://")
}

/// Heuristic: does this parsed JSON look like CNY data (vs a Product array)?
pub fn is_cny_payload(data: &Value) -> bool {
    let probe: Option<&Value> = if data.is_array() {
        data.get(0)
    } else {
        data.pointer("/products/0")
            .filter(|v| !v.is_null())
            .or_else(|| data.pointer("/product/0").filter(|v| !v.is_null()))
            .or(Some(data))
    };
    let Some(p) = probe else { return false };
    if p.is_null() || !(p.is_object() || p.is_array()) {
        return false;
    }
    p.get("product_data").is_some()
        || (p.get("sku").is_some() && (p.get("basePrice").is_some() || p.get("tags").is_some()))
}

const THEMES: [&str; 4] = ["promotion", "flash_sale", "bestseller", "new_arrival"];

/// Filter by theme tag and/or keyword (code or name, case-insensitive).
pub fn filter_cny(products: &[Product], theme: Option<&str>, keywords: Option<&str>) -> Vec<Product> {
    let mut out: Vec<Product> = products.to_vec();
    if let Some(t) = theme.filter(|t| THEMES.contains(t)) {
        out.retain(|p| p.tags.as_deref().unwrap_or(&[]).iter().any(|tag| tag == t));
    }
    if let Some(k) = keywords.filter(|k| !k.is_empty()) {
        let k = k.to_lowercase();
        out.retain(|p| p.code.to_lowercase().contains(&k) || p.name.to_lowercase().contains(&k));
    }
    out
}
