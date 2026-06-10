//! Golden tests: rebuild every case from test/golden/cases.mjs (inputs
//! reproduced below as fixed literals) and compare against the committed
//! ../test/golden/fixtures.json — the same file the JS golden test asserts
//! against, so the JS lib and the Rust port can never drift apart.
//!
//! Comparison is canonical: parsed `serde_json::Value` equality, never string
//! equality, so key order / float formatting cannot cause false failures.

use serde_json::{json, Value};

use prom9_core::flex::builder::{
    build_carousel, build_carousels, build_flex_message, Product, PromoInfo, Template,
};
use prom9_core::flex::validate::validate;

const IMG: &str = "https://example.com/p.jpg";

fn fixtures() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../test/golden/fixtures.json");
    let text = std::fs::read_to_string(path).expect("read test/golden/fixtures.json");
    serde_json::from_str(&text).expect("parse fixtures.json")
}

/// The 12 edge-case products from cases.mjs `PRODUCTS` (one per edge case).
fn products() -> Vec<Product> {
    vec![
        // every field populated + money() float edge: 731.3299999 -> "731.33"
        Product {
            code: "A100".into(),
            name: "วิตามินซี 1000 มก.".into(),
            image_url: IMG.into(),
            price_normal: Some(990.0),
            price_sale: Some(731.3299999),
            promo_type: "flash".into(),
            unit_text: Some("ขวด [123]".into()),
            note: Some("ซื้อ 2 แถม 1".into()),
            expire_text: Some("⏰ ถึง 14 ก.พ.".into()),
            stock_text: Some("เหลือ 12 ชิ้น".into()),
            points_text: Some("รับ 70 แต้ม".into()),
            promo: Some(PromoInfo {
                kind: "percent".into(),
                discount: 26.0,
                ends_at: Some("2025-02-14".into()),
                ..Default::default()
            }),
            ..Default::default()
        },
        // sale price only + float edge: 26.6699999 -> "26.67"; lastlot preset note
        Product {
            code: "B200".into(),
            name: "เจลล้างมือ".into(),
            image_url: IMG.into(),
            price_sale: Some(26.6699999),
            promo_type: "lastlot".into(),
            ..Default::default()
        },
        // normal price only + thousand grouping: 1234567.891 -> "1,234,567.89"
        Product {
            code: "C300".into(),
            name: "เครื่องวัดความดัน".into(),
            image_url: IMG.into(),
            price_normal: Some(1234567.891),
            promo_type: "member".into(),
            ..Default::default()
        },
        // no prices at all -> "สอบถามราคา" / "—" paths
        Product {
            code: "D400".into(),
            name: "สินค้าสอบถามราคา".into(),
            image_url: IMG.into(),
            promo_type: "custom".into(),
            ..Default::default()
        },
        // unknown preset falls back to custom; integer price drops ".00": "1,000"
        Product {
            code: "E500".into(),
            name: "พรีเซ็ตแปลก".into(),
            image_url: IMG.into(),
            price_normal: Some(1000.0),
            promo_type: "weird".into(),
            ..Default::default()
        },
        // badgeText/badgeColor overrides beat the preset values
        Product {
            code: "F600".into(),
            name: "ป้ายกำหนดเอง".into(),
            image_url: IMG.into(),
            price_normal: Some(250.0),
            price_sale: Some(199.0),
            promo_type: "flash".into(),
            badge_text: Some("ลดแรง!".into()),
            badge_color: Some("#0A84FF".into()),
            ..Default::default()
        },
        // money() strips one trailing zero: 26.6 -> "26.6" (not "26.60")
        Product {
            code: "G700".into(),
            name: "เลขท้ายศูนย์".into(),
            image_url: IMG.into(),
            price_normal: Some(50.0),
            price_sale: Some(26.6),
            promo_type: "flash".into(),
            ..Default::default()
        },
        // CTA label "สนใจ รหัส LONGCODE123456" > 20 chars -> sliced to 20
        Product {
            code: "LONGCODE123456".into(),
            name: "รหัสยาว".into(),
            image_url: IMG.into(),
            price_sale: Some(99.0),
            promo_type: "flash".into(),
            ..Default::default()
        },
        // inverted prices (normal < sale) -> no strike-through, no % chip, no ประหยัด
        Product {
            code: "H800".into(),
            name: "ราคากลับด้าน".into(),
            image_url: IMG.into(),
            price_normal: Some(100.0),
            price_sale: Some(150.0),
            promo_type: "flash".into(),
            ..Default::default()
        },
        // parenthesised unit cleaning: "แพ็ค (6 ชิ้น)" -> "แพ็คละ"
        Product {
            code: "I900".into(),
            name: "หน่วยมีวงเล็บ".into(),
            image_url: IMG.into(),
            price_sale: Some(350.0),
            promo_type: "flash".into(),
            unit_text: Some("แพ็ค (6 ชิ้น)".into()),
            ..Default::default()
        },
        // http:// image -> validate() error in every template
        Product {
            code: "J010".into(),
            name: "รูปไม่ปลอดภัย".into(),
            image_url: "http://example.com/p.jpg".into(),
            price_sale: Some(75.0),
            promo_type: "flash".into(),
            ..Default::default()
        },
        // urgent template without _promo.endsAt -> plain "⏰ ด่วน! โปรหมดเร็ว" strip
        Product {
            code: "K020".into(),
            name: "ไม่มีวันหมดโปร".into(),
            image_url: IMG.into(),
            price_normal: Some(120.0),
            price_sale: Some(89.0),
            promo_type: "flash".into(),
            note: Some("ของแถมหมดแล้วหมดเลย".into()),
            ..Default::default()
        },
    ]
}

const TEMPLATES: [(&str, Template); 5] = [
    ("classic", Template::Classic),
    ("promo", Template::Promo),
    ("bigprice", Template::BigPrice),
    ("minimal", Template::Minimal),
    ("urgent", Template::Urgent),
];

/// 25 minimal products -> buildCarousels chunks into 12 / 12 / 1.
fn chunk_products() -> Vec<Product> {
    (0..25)
        .map(|i| Product {
            code: format!("C{i:03}"),
            name: format!("สินค้า {i}"),
            image_url: IMG.into(),
            price_normal: Some(100.0 + i as f64),
            promo_type: "flash".into(),
            ..Default::default()
        })
        .collect()
}

fn assert_case_eq(got: &Value, want: &Value, label: &str) {
    if got != want {
        // Narrow down the first mismatch for a readable failure.
        if let (Some(ga), Some(wa)) = (got.as_array(), want.as_array()) {
            assert_eq!(ga.len(), wa.len(), "{label}: array length");
            for (i, (g, w)) in ga.iter().zip(wa).enumerate() {
                assert_case_eq(g, w, &format!("{label}[{i}]"));
            }
        }
        if let (Some(go), Some(wo)) = (got.as_object(), want.as_object()) {
            let gk: Vec<_> = go.keys().collect();
            let wk: Vec<_> = wo.keys().collect();
            let mut all: Vec<_> = gk.iter().chain(wk.iter()).collect();
            all.sort();
            all.dedup();
            for k in all {
                assert_case_eq(
                    go.get(*k).unwrap_or(&Value::Null),
                    wo.get(*k).unwrap_or(&Value::Null),
                    &format!("{label}.{k}"),
                );
            }
        }
        panic!(
            "{label} mismatch:\n  got:  {}\n  want: {}",
            serde_json::to_string(got).unwrap(),
            serde_json::to_string(want).unwrap()
        );
    }
}

#[test]
fn golden_templates_all_five() {
    let fx = fixtures();
    let products = products();
    for (name, template) in TEMPLATES {
        let carousel = build_carousel(&products, template).expect("12 products fit");
        let want = &fx["cases"]["templates"][name];
        assert!(!want.is_null(), "fixture missing templates.{name}");
        assert_case_eq(&carousel, want, &format!("templates.{name}"));
    }
}

#[test]
fn golden_validation_per_template() {
    let fx = fixtures();
    let products = products();
    for (name, template) in TEMPLATES {
        let carousel = build_carousel(&products, template).expect("12 products fit");
        let got = serde_json::to_value(validate(&carousel)).unwrap();
        let want = &fx["cases"]["validation"][name];
        assert!(!want.is_null(), "fixture missing validation.{name}");
        assert_case_eq(&got, want, &format!("validation.{name}"));
    }
}

#[test]
fn golden_chunking_25_products_splits_12_12_1() {
    let fx = fixtures();
    let got = Value::Array(build_carousels(&chunk_products(), Template::Classic));
    assert_case_eq(&got, &fx["cases"]["chunking"], "chunking");
}

#[test]
fn golden_envelope_default_and_custom_alt_text() {
    let fx = fixtures();
    let small = build_carousel(&products()[..2], Template::Classic).unwrap();
    assert_case_eq(
        &build_flex_message(&small, None),
        &fx["cases"]["envelope"]["default"],
        "envelope.default",
    );
    assert_case_eq(
        &build_flex_message(&small, Some("โปรเดือนนี้")),
        &fx["cases"]["envelope"]["custom"],
        "envelope.custom",
    );
}

#[test]
fn golden_validate_edge_cases() {
    let fx = fixtures();
    let edge = &fx["cases"]["validateEdge"];

    let empty = serde_json::to_value(validate(&json!({ "type": "carousel", "contents": [] }))).unwrap();
    assert_case_eq(&empty, &edge["empty"], "validateEdge.empty");

    let not_carousel = serde_json::to_value(validate(&json!({}))).unwrap();
    assert_case_eq(&not_carousel, &edge["notCarousel"], "validateEdge.notCarousel");

    // Hand-built bubble: 25-char footer action label -> length warning.
    let long_label_carousel = json!({
        "type": "carousel",
        "contents": [{
            "type": "bubble",
            "hero": { "type": "image", "url": IMG, "size": "full", "aspectRatio": "1:1", "aspectMode": "cover" },
            "body": { "type": "box", "layout": "vertical", "contents": [{ "type": "text", "text": "ทดสอบ label ยาว" }] },
            "footer": {
                "type": "box", "layout": "vertical",
                "contents": [{
                    "type": "button", "style": "primary",
                    "action": { "type": "message", "label": "AAAAAAAAAAAAAAAAAAAAAAAAA", "text": "สนใจ" },
                }],
            },
        }],
    });
    let long_label = serde_json::to_value(validate(&long_label_carousel)).unwrap();
    assert_case_eq(&long_label, &edge["longLabel"], "validateEdge.longLabel");
}

#[test]
fn fixture_case_groups_are_all_covered() {
    let fx = fixtures();
    let mut keys: Vec<&str> = fx["cases"].as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, vec!["chunking", "envelope", "templates", "validateEdge", "validation"]);
}
