//! Source Adapters — port of `lib/adapters.js`.
//!
//! Reads & normalizes product data from Google Sheet (CSV) and JSON into the
//! internal [`Product`] schema used by the Flex Builder. Raw rows/objects are
//! handled as `serde_json::Value` so the JS coercion rules (`String(v)`,
//! `Number(v)`, truthiness) carry over for messy real-world payloads.

use serde_json::{Map, Value};

use crate::flex::builder::Product;
use crate::jsutil::{is_js_whitespace, js_parse_number, js_string, js_trim, js_truthy};

pub const PROMO_TYPES: [&str; 4] = ["flash", "lastlot", "member", "custom"];

// --- Google Sheet helpers ---------------------------------------------------

/// Accepts a full Sheet URL or a bare spreadsheet id and returns the gviz CSV
/// export endpoint. Errors (with the JS message) if no id can be extracted.
pub fn sheet_csv_url(input: &str, sheet_name: Option<&str>) -> Result<String, String> {
    let id = extract_sheet_id(input).ok_or_else(|| "ไม่พบ Spreadsheet ID จากค่าที่กรอก".to_string())?;
    let base = format!("https://docs.google.com/spreadsheets/d/{id}/gviz/tq?tqx=out:csv");
    Ok(match sheet_name.map(js_trim).filter(|s| !s.is_empty()) {
        Some(name) => format!("{base}&sheet={}", encode_uri_component(name)),
        None => base,
    })
}

fn extract_sheet_id(input: &str) -> Option<String> {
    let s = js_trim(input);
    // /\/d\/([a-zA-Z0-9-_]+)/ — first "/d/" followed by at least one id char.
    let bytes = s.as_bytes();
    let mut i = 0;
    while i + 3 <= bytes.len() {
        if &bytes[i..i + 3] == b"/d/" {
            let start = i + 3;
            let mut j = start;
            while j < bytes.len() && is_id_byte(bytes[j]) {
                j += 1;
            }
            if j > start {
                return Some(s[start..j].to_string());
            }
        }
        i += 1;
    }
    // /^[a-zA-Z0-9-_]{20,}$/ — looks like a bare id.
    if s.len() >= 20 && s.bytes().all(is_id_byte) {
        return Some(s.to_string());
    }
    None
}

fn is_id_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'-' || b == b'_'
}

/// `encodeURIComponent` (unreserved set: A-Z a-z 0-9 - _ . ! ~ * ' ( )).
fn encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '!' | '~' | '*' | '\'' | '(' | ')') {
            out.push(c);
        } else {
            let mut buf = [0u8; 4];
            for b in c.encode_utf8(&mut buf).bytes() {
                out.push_str(&format!("%{b:02X}"));
            }
        }
    }
    out
}

// --- CSV parsing --------------------------------------------------------------

/// Minimal RFC-4180-ish CSV parser: quoted fields, escaped quotes, commas /
/// newlines inside quotes.
pub fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let chars: Vec<char> = text.chars().collect();
    let mut rows: Vec<Vec<String>> = vec![];
    let mut row: Vec<String> = vec![];
    let mut field = String::new();
    let mut in_quotes = false;

    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if in_quotes {
            if c == '"' {
                if chars.get(i + 1) == Some(&'"') {
                    field.push('"');
                    i += 1;
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(c);
            }
        } else if c == '"' {
            in_quotes = true;
        } else if c == ',' {
            row.push(std::mem::take(&mut field));
        } else if c == '\n' {
            row.push(std::mem::take(&mut field));
            rows.push(std::mem::take(&mut row));
        } else if c != '\r' {
            field.push(c);
        }
        i += 1;
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

// --- Normalizers ----------------------------------------------------------------

pub fn normalize_from_csv(text: &str) -> Vec<Product> {
    let rows: Vec<Vec<String>> = parse_csv(text)
        .into_iter()
        .filter(|r| r.iter().any(|c| !js_trim(c).is_empty()))
        .collect();
    let Some((header_row, data_rows)) = rows.split_first() else {
        return vec![];
    };
    let header: Vec<String> = header_row.iter().map(|h| js_trim(h).to_lowercase()).collect();
    data_rows
        .iter()
        .map(|r| {
            let mut obj = Map::new();
            for (i, h) in header.iter().enumerate() {
                let cell = r.get(i).map(String::as_str).unwrap_or("");
                obj.insert(h.clone(), Value::String(js_trim(cell).to_string()));
            }
            to_product(&Value::Object(obj))
        })
        .filter(is_usable)
        .collect()
}

/// Accepts a bare array, `{ products: [...] }`, or a single object.
pub fn normalize_from_json(data: &Value) -> Vec<Product> {
    let single = std::slice::from_ref(data);
    let arr: &[Value] = if let Some(a) = data.as_array() {
        a
    } else if let Some(a) = data.get("products").and_then(Value::as_array) {
        a
    } else {
        single
    };
    arr.iter().map(to_product).filter(is_usable).collect()
}

/// String input variant (`normalizeFromJson(jsonText)`).
pub fn normalize_from_json_str(input: &str) -> Result<Vec<Product>, String> {
    let data: Value = serde_json::from_str(input).map_err(|e| e.to_string())?;
    Ok(normalize_from_json(&data))
}

fn is_usable(p: &Product) -> bool {
    !p.code.is_empty() && !p.name.is_empty() && !p.image_url.is_empty()
}

/// Map a raw row/object (snake_case from Sheet, camelCase from JSON) into a Product.
pub fn to_product(raw: &Value) -> Product {
    let promo_raw = pick(raw, &["promoType", "promo_type"])
        .filter(|v| js_truthy(v)) // JS: `pick(...) || 'custom'`
        .map(js_string)
        .unwrap_or_else(|| "custom".to_string());
    let promo_raw = js_trim(&promo_raw).to_lowercase();
    let promo_type = if PROMO_TYPES.contains(&promo_raw.as_str()) {
        promo_raw
    } else {
        "custom".to_string()
    };

    Product {
        code: str_of(pick(raw, &["code"])),
        name: str_of(pick(raw, &["name"])),
        image_url: str_of(pick(raw, &["imageUrl", "image_url", "image"])),
        price_normal: num_of(pick(raw, &["priceNormal", "price_normal"])),
        price_sale: num_of(pick(raw, &["priceSale", "price_sale"])),
        promo_type,
        badge_text: opt_of(pick(raw, &["badgeText", "badge"])),
        badge_color: opt_of(pick(raw, &["badgeColor", "badge_color"])),
        expire_text: enrich_expire(pick(raw, &["expireText", "expire"])),
        stock_text: opt_of(pick(raw, &["stockText", "stock"])),
        points_text: enrich_points(pick(raw, &["pointsText", "points"])),
        note: opt_of(pick(raw, &["note"])),
        unit_text: None,
        tags: None,
        promo: None,
    }
}

// --- small helpers -----------------------------------------------------------

/// First key whose value is present, non-null and not whitespace-only when
/// stringified.
fn pick<'a>(raw: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    for k in keys {
        if let Some(v) = raw.get(*k) {
            if !v.is_null() && !js_trim(&js_string(v)).is_empty() {
                return Some(v);
            }
        }
    }
    None
}

/// `str(v)`: undefined -> "", else `String(v).trim()`.
fn str_of(v: Option<&Value>) -> String {
    v.map(|v| js_trim(&js_string(v)).to_string()).unwrap_or_default()
}

/// `opt(v)`: undefined -> undefined, else `String(v).trim()`.
fn opt_of(v: Option<&Value>) -> Option<String> {
    v.map(|v| js_trim(&js_string(v)).to_string())
}

/// `num(v)`: strip `[,\s฿]`, then `Number(...)`; non-finite -> undefined.
fn num_of(v: Option<&Value>) -> Option<f64> {
    let v = v?;
    let n = match v {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        other => {
            let cleaned: String = js_string(other)
                .chars()
                .filter(|&c| c != ',' && c != '฿' && !is_js_whitespace(c))
                .collect();
            js_parse_number(&cleaned)
        }
    };
    n.is_finite().then_some(n)
}

/// "ถึง 30 มิ.ย." -> "⏰ ถึง 30 มิ.ย." (left alone if it already has a glyph).
fn enrich_expire(v: Option<&Value>) -> Option<String> {
    let s = js_trim(&js_string(v?)).to_string();
    if s.is_empty() {
        return None;
    }
    Some(if s.chars().any(|c| matches!(c, '⏰' | '🗓' | '📅')) {
        s
    } else {
        format!("⏰ {s}")
    })
}

/// "70" -> "รับ 70 แต้ม"; otherwise pass the text through unchanged.
fn enrich_points(v: Option<&Value>) -> Option<String> {
    let s = js_trim(&js_string(v?)).to_string();
    if s.is_empty() {
        return None;
    }
    Some(if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) {
        format!("รับ {s} แต้ม")
    } else {
        s
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sheet_url_from_full_url_bare_id_and_sheet_name() {
        assert_eq!(
            sheet_csv_url("https://docs.google.com/spreadsheets/d/abc-DEF_123/edit#gid=0", None).unwrap(),
            "https://docs.google.com/spreadsheets/d/abc-DEF_123/gviz/tq?tqx=out:csv"
        );
        assert_eq!(
            sheet_csv_url("1A2b3C4d5E6f7G8h9I0jKLMNOP", Some(" สินค้า Sale ")).unwrap(),
            "https://docs.google.com/spreadsheets/d/1A2b3C4d5E6f7G8h9I0jKLMNOP/gviz/tq?tqx=out:csv&sheet=%E0%B8%AA%E0%B8%B4%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2%20Sale"
        );
        assert_eq!(
            sheet_csv_url("not an id", None).unwrap_err(),
            "ไม่พบ Spreadsheet ID จากค่าที่กรอก"
        );
        // Too short for a bare id.
        assert!(sheet_csv_url("shortid", None).is_err());
    }

    #[test]
    fn csv_parser_handles_quotes_commas_newlines() {
        assert_eq!(
            parse_csv("a,b\n\"x,y\",\"he said \"\"hi\"\"\"\n\"multi\nline\",z"),
            vec![
                vec!["a", "b"],
                vec!["x,y", "he said \"hi\""],
                vec!["multi\nline", "z"],
            ]
        );
        assert_eq!(parse_csv("a,b\r\nc,d\n"), vec![vec!["a", "b"], vec!["c", "d"]]);
        assert!(parse_csv("").is_empty());
    }

    #[test]
    fn csv_normalization_maps_headers_and_coerces() {
        let csv = "Code,Name,image_url,price_normal,Price_Sale,promo_type,points,expire\n\
                   A1,วิตามิน,https://x.test/a.jpg,\"1,290 ฿\",990,FLASH,70,ถึง 30 มิ.ย.\n\
                   ,missing-code,https://x.test/b.jpg,5,,custom,,\n";
        let products = normalize_from_csv(csv);
        assert_eq!(products.len(), 1); // second row filtered (no code)
        let p = &products[0];
        assert_eq!(p.code, "A1");
        assert_eq!(p.price_normal, Some(1290.0));
        assert_eq!(p.price_sale, Some(990.0));
        assert_eq!(p.promo_type, "flash"); // lowercased
        assert_eq!(p.points_text.as_deref(), Some("รับ 70 แต้ม"));
        assert_eq!(p.expire_text.as_deref(), Some("⏰ ถึง 30 มิ.ย."));
    }

    #[test]
    fn json_normalization_handles_array_products_and_single_object() {
        let one = json!({ "code": "A", "name": "n", "image": "https://x.test/a.jpg", "priceSale": "26.6" });
        let p = normalize_from_json(&one);
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].image_url, "https://x.test/a.jpg");
        assert_eq!(p[0].price_sale, Some(26.6));
        assert_eq!(p[0].promo_type, "custom");

        let wrapped = json!({ "products": [one] });
        assert_eq!(normalize_from_json(&wrapped).len(), 1);
        assert_eq!(normalize_from_json_str("[{\"code\":\"A\",\"name\":\"n\",\"imageUrl\":\"u\"}]").unwrap().len(), 1);
    }

    #[test]
    fn to_product_quirks_match_js() {
        // weird promoType falls back to custom; expire keeps existing glyph.
        let p = to_product(&json!({
            "code": 42, "name": "  n  ", "imageUrl": "u",
            "promoType": "WeIrD", "expire": "📅 30 มิ.ย.", "points": "ดับเบิ้ลแต้ม",
            "priceNormal": "฿ 1 234,56", "priceSale": "abc",
        }));
        assert_eq!(p.code, "42"); // String(42)
        assert_eq!(p.name, "n");
        assert_eq!(p.promo_type, "custom");
        assert_eq!(p.expire_text.as_deref(), Some("📅 30 มิ.ย."));
        assert_eq!(p.points_text.as_deref(), Some("ดับเบิ้ลแต้ม"));
        assert_eq!(p.price_normal, Some(123456.0)); // commas/spaces/฿ stripped
        assert_eq!(p.price_sale, None); // NaN -> undefined
    }
}
