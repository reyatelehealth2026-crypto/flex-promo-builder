//! Validation — port of `lib/validate.js`.
//!
//! Enforces the LINE Flex constraints:
//!   - carousel <= 12 bubbles
//!   - payload <= ~50KB
//!   - hero image URLs must be https
//!   - footer button action labels <= 20 chars (warning only)

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::jsutil::{js_math_round, utf16_len};

pub const MAX_BUBBLES: usize = 12;
pub const MAX_BYTES: usize = 50 * 1024; // ~50KB hard limit
pub const WARN_BYTES: usize = 45 * 1024; // start warning before the limit

/// `validate()` result; serializes to the same `{ ok, errors, warnings, bytes }`
/// shape the JS module returns (and the golden fixtures pin).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Validation {
    pub ok: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub bytes: usize,
}

/// UTF-8 byte length of the value's compact JSON serialization
/// (`new TextEncoder().encode(JSON.stringify(obj)).length`).
pub fn byte_length(value: &Value) -> usize {
    serde_json::to_string(value).map(|s| s.len()).unwrap_or(0)
}

/// UTF-8 byte length of a raw string (the JS overload for string input).
pub fn byte_length_str(s: &str) -> usize {
    s.len()
}

/// Validate a single carousel.
pub fn validate(carousel: &Value) -> Validation {
    let mut errors = vec![];
    let mut warnings = vec![];

    if carousel.get("type").and_then(Value::as_str) != Some("carousel") {
        return Validation {
            ok: false,
            errors: vec!["โครงสร้างไม่ใช่ carousel".to_string()],
            warnings,
            bytes: 0,
        };
    }

    static EMPTY: Vec<Value> = vec![];
    let bubbles: &Vec<Value> = carousel
        .get("contents")
        .and_then(Value::as_array)
        .unwrap_or(&EMPTY);

    if bubbles.is_empty() {
        errors.push("ยังไม่มี bubble (ยังไม่ได้เลือกสินค้า)".to_string());
    }
    if bubbles.len() > MAX_BUBBLES {
        errors.push(format!(
            "carousel มี {} bubble เกินขีดจำกัด {}",
            bubbles.len(),
            MAX_BUBBLES
        ));
    }

    for (i, b) in bubbles.iter().enumerate() {
        let url = first_image_url(b);
        if !is_https(&url) {
            let shown = if url.is_empty() { "ว่าง" } else { url.as_str() };
            errors.push(format!("bubble {}: รูปสินค้าต้องเป็น https ({})", i + 1, shown));
        }
        let label = b
            .pointer("/footer/contents/0/action/label")
            .and_then(Value::as_str)
            .unwrap_or("");
        if utf16_len(label) > 20 {
            warnings.push(format!("bubble {}: label ปุ่มยาวเกิน 20 ตัวอักษร", i + 1));
        }
    }

    let bytes = byte_length(carousel);
    if bytes > MAX_BYTES {
        errors.push(format!(
            "payload {} เกินขีดจำกัด {}",
            fmt_bytes(bytes),
            fmt_bytes(MAX_BYTES)
        ));
    } else if bytes > WARN_BYTES {
        warnings.push(format!(
            "payload {} ใกล้เกินขีดจำกัด {}",
            fmt_bytes(bytes),
            fmt_bytes(MAX_BYTES)
        ));
    }

    Validation {
        ok: errors.is_empty(),
        errors,
        warnings,
        bytes,
    }
}

/// `/^https:\/\//i`
fn is_https(url: &str) -> bool {
    url.len() >= 8 && url.as_bytes()[..8].eq_ignore_ascii_case(b"https://")
}

// First image URL in a bubble — hero (classic) or the first image inside body
// (SPECIAL PROMO template panel).
fn first_image_url(b: &Value) -> String {
    if let Some(url) = b.pointer("/hero/url").and_then(Value::as_str) {
        return url.to_string();
    }
    b.get("body")
        .and_then(find_image_url)
        .unwrap_or_default()
        .to_string()
}

fn find_image_url(node: &Value) -> Option<&str> {
    let obj = node.as_object()?;
    if obj.get("type").and_then(Value::as_str) == Some("image") {
        if let Some(u) = obj.get("url").and_then(Value::as_str) {
            // JS `if (u) return u;` — an empty url is treated as not found.
            if !u.is_empty() {
                return Some(u);
            }
        }
    }
    if let Some(contents) = obj.get("contents").and_then(Value::as_array) {
        for k in contents {
            if let Some(u) = find_image_url(k) {
                return Some(u);
            }
        }
    }
    None
}

/// `fmtBytes`: "512 B" below 1KB, otherwise "X.Y KB" with JS `toFixed(1)`
/// semantics (ties round toward the larger value).
pub fn fmt_bytes(n: usize) -> String {
    if n < 1024 {
        return format!("{n} B");
    }
    // (n / 1024).toFixed(1): n/1024 and its *10 are exact in f64 here, so
    // toFixed reduces to "closest tenth, ties up".
    let tenths = js_math_round(n as f64 / 1024.0 * 10.0) as u64;
    format!("{}.{} KB", tenths / 10, tenths % 10)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn bubble(url: &str, label: &str) -> Value {
        json!({
            "type": "bubble",
            "hero": { "type": "image", "url": url, "size": "full", "aspectRatio": "1:1", "aspectMode": "cover" },
            "body": { "type": "box", "layout": "vertical", "contents": [{ "type": "text", "text": "x" }] },
            "footer": {
                "type": "box", "layout": "vertical",
                "contents": [{ "type": "button", "style": "primary",
                               "action": { "type": "message", "label": label, "text": "สนใจ" } }],
            },
        })
    }

    #[test]
    fn rejects_non_carousel() {
        let v = validate(&json!({}));
        assert_eq!(v.errors, vec!["โครงสร้างไม่ใช่ carousel"]);
        assert_eq!(v.bytes, 0);
        assert!(!v.ok);
        assert!(!validate(&Value::Null).ok);
    }

    #[test]
    fn empty_carousel_is_an_error() {
        let v = validate(&json!({ "type": "carousel", "contents": [] }));
        assert_eq!(v.errors, vec!["ยังไม่มี bubble (ยังไม่ได้เลือกสินค้า)"]);
        assert_eq!(v.bytes, 33); // {"type":"carousel","contents":[]}
    }

    #[test]
    fn more_than_12_bubbles_is_an_error() {
        let bubbles: Vec<Value> = (0..13).map(|_| bubble("https://x.test/p.jpg", "ok")).collect();
        let v = validate(&json!({ "type": "carousel", "contents": bubbles }));
        assert_eq!(v.errors, vec!["carousel มี 13 bubble เกินขีดจำกัด 12"]);
    }

    #[test]
    fn http_image_is_an_error_and_https_is_case_insensitive() {
        let v = validate(&json!({ "type": "carousel", "contents": [
            bubble("http://example.com/p.jpg", "ok"),
            bubble("HTTPS://example.com/p.jpg", "ok"),
            bubble("", "ok"),
        ]}));
        assert_eq!(v.errors, vec![
            "bubble 1: รูปสินค้าต้องเป็น https (http://example.com/p.jpg)",
            "bubble 3: รูปสินค้าต้องเป็น https (ว่าง)",
        ]);
    }

    #[test]
    fn finds_image_inside_body_when_no_hero() {
        let b = json!({
            "type": "bubble",
            "body": { "type": "box", "layout": "vertical", "contents": [
                { "type": "box", "layout": "vertical", "contents": [
                    { "type": "image", "url": "https://example.com/in-body.jpg" },
                ]},
            ]},
        });
        let v = validate(&json!({ "type": "carousel", "contents": [b] }));
        assert!(v.ok, "{:?}", v.errors);
    }

    #[test]
    fn label_longer_than_20_utf16_units_warns() {
        let v = validate(&json!({ "type": "carousel", "contents": [
            bubble("https://x.test/p.jpg", "AAAAAAAAAAAAAAAAAAAA"),   // 20 -> ok
            bubble("https://x.test/p.jpg", "AAAAAAAAAAAAAAAAAAAAA"),  // 21 -> warn
            bubble("https://x.test/p.jpg", "สนใจ รหัส LONGCODE123456"), // 24 utf16 units
        ]}));
        assert!(v.ok);
        assert_eq!(v.warnings, vec![
            "bubble 2: label ปุ่มยาวเกิน 20 ตัวอักษร",
            "bubble 3: label ปุ่มยาวเกิน 20 ตัวอักษร",
        ]);
    }

    #[test]
    fn byte_limits_error_and_warn() {
        // One bubble padded so the payload crosses the limits.
        let pad = |n: usize| "x".repeat(n);
        let big = json!({ "type": "carousel", "contents": [
            { "type": "bubble",
              "hero": { "type": "image", "url": "https://x.test/p.jpg" },
              "body": { "type": "box", "layout": "vertical",
                        "contents": [{ "type": "text", "text": pad(51 * 1024) }] } },
        ]});
        let v = validate(&big);
        assert!(!v.ok);
        assert!(v.errors[0].starts_with("payload "), "{:?}", v.errors);
        assert!(v.errors[0].contains("เกินขีดจำกัด 50.0 KB"), "{:?}", v.errors);

        let warm = json!({ "type": "carousel", "contents": [
            { "type": "bubble",
              "hero": { "type": "image", "url": "https://x.test/p.jpg" },
              "body": { "type": "box", "layout": "vertical",
                        "contents": [{ "type": "text", "text": pad(46 * 1024) }] } },
        ]});
        let v = validate(&warm);
        assert!(v.ok);
        assert!(v.warnings[0].contains("ใกล้เกินขีดจำกัด 50.0 KB"), "{:?}", v.warnings);
    }

    #[test]
    fn fmt_bytes_matches_js_to_fixed_1() {
        assert_eq!(fmt_bytes(500), "500 B");
        assert_eq!(fmt_bytes(1023), "1023 B");
        assert_eq!(fmt_bytes(1024), "1.0 KB");
        assert_eq!(fmt_bytes(51200), "50.0 KB");
        assert_eq!(fmt_bytes(46080), "45.0 KB");
        assert_eq!(fmt_bytes(1536), "1.5 KB");
        assert_eq!(fmt_bytes(1587), "1.5 KB"); // 1.5498... -> 1.5
        assert_eq!(fmt_bytes(1126), "1.1 KB"); // 1.0996... -> 1.1
        // tie: 1.05 exactly (1075.2 not integer; use 13107.2? choose 2^x):
        // 1024 * 1.05 = 1075.2 -> not reachable from integer bytes, but
        // 1129.6 etc. aren't either; exact .x5 ties need n*10 % 512 == 256:
        assert_eq!(fmt_bytes(1075), "1.0 KB"); // 1.0498 -> 1.0
    }

    #[test]
    fn byte_length_counts_utf8() {
        assert_eq!(byte_length_str("abc"), 3);
        assert_eq!(byte_length_str("ไทย"), 9);
        assert_eq!(byte_length(&json!({"a":"ไทย"})), 17); // {"a":"ไทย"} = 8 ASCII + 9 Thai bytes
    }
}
