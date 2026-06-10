//! Cross-language parity tests for the ingest (cny / promo) and compositor
//! ports. tests/data/expected.json is generated from the live JS libs by
//! tools/gen-expected.mjs (same idea as test/golden/fixtures.json, which
//! covers the flex builder + validate).
//!
//! Numbers are normalized before comparison (integral floats -> integers) so
//! Rust's `5.0` and JS's `5` compare equal; everything else must match
//! exactly, including Thai strings.

use serde_json::{json, Map, Value};

use prom9_core::creative::compositor::{
    build_banner, build_overlay, build_promo_card, BrandOverride, CompositorOpts,
};
use prom9_core::ingest::cny::{cny_to_product, filter_cny, flatten_cny_item, normalize_from_cny};
use prom9_core::ingest::promo::{build_promo_products, extract_promotions};
use prom9_core::Product;

fn expected() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/data/expected.json");
    let text = std::fs::read_to_string(path).expect("read tests/data/expected.json");
    serde_json::from_str(&text).expect("parse expected.json")
}

/// Canonicalize numbers: any float with no fractional part becomes an integer
/// so the Rust (f64-based) and JS (mixed) sides compare equal.
fn normalize(v: Value) -> Value {
    match v {
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if f.fract() == 0.0 && f.abs() < 9e15 {
                    return json!(f as i64);
                }
            }
            Value::Number(n)
        }
        Value::Array(a) => Value::Array(a.into_iter().map(normalize).collect()),
        Value::Object(o) => Value::Object(
            o.into_iter().map(|(k, v)| (k, normalize(v))).collect::<Map<_, _>>(),
        ),
        other => other,
    }
}

fn assert_parity(got: Value, want: &Value, label: &str) {
    let got = normalize(got);
    let want = normalize(want.clone());
    assert_eq!(
        got,
        want,
        "{label} mismatch:\n  got:  {}\n  want: {}",
        serde_json::to_string(&got).unwrap(),
        serde_json::to_string(&want).unwrap()
    );
}

fn products_value(products: &[Product]) -> Value {
    serde_json::to_value(products).unwrap()
}

// ---- inputs (mirrors of tools/gen-expected.mjs) -----------------------------

fn raw_cny_page() -> Value {
    json!({
        "product": [
            {
                "product_data": [{
                    "id": 101, "sku": "SKU-101", "name": "ยาดมสมุนไพร", "name_en": " Herbal Inhaler ",
                    "spec_name": " หลอด ", "is_promotion": 1, "is_bestseller": 0, "is_recommend": 1,
                }],
                "product_price": [{ "product_price": [{ "price": "120.50", "promotion_price": 99 }] }],
                "product_photo": [{ "photo_path": "uploads/product_photo/a.jpg" }],
                "product_unit": [{ "unit": "หลอด" }],
                "product_stock": [{ "stock_num": 3 }, { "stock_num": "4" }],
                "product_is_flashSale": 1,
                "customer_buyed": 0,
                "is_rx": 0,
            },
            {
                "product_data": [{ "id": 101, "sku": "SKU-101-DUP", "name": "ซ้ำ" }],
                "product_price": [{ "product_price": [{ "price": 50 }] }],
                "product_photo": [],
                "product_unit": [],
                "product_stock": [],
            },
            {
                "product_data": [{ "id": 102, "sku": "SKU-102", "name": "วิตามินรวม", "is_bestseller": 1 }],
                "product_price": [{ "product_price": [{ "price": 731.3299999, "promotion_price": 900 }] }],
                "product_photo": [],
                "product_unit": [{ "unit": "ขวด [30 เม็ด]" }],
                "product_stock": [{ "stock_num": 99 }],
                "customer_buyed": 5,
                "is_rx": 1,
            },
            {
                "product_data": [{ "id": 103, "name": "ไม่มีรหัส" }],
                "product_price": [{ "product_price": [{ "price": 10 }] }],
            },
        ],
        "paginate": { "total": 4 },
        "data_promotion_only": [
            {
                "campaign_name": "แคมเปญเปอร์เซ็นต์",
                "data_product": [
                    { "id": 101, "unit": "หลอด", "qty": 3, "discount": 10, "discount_type": "percent",
                      "is_buy_pack": 0, "campaign_type": "normal", "campaign_name": "แคมเปญเปอร์เซ็นต์", "end_pro": "2025-03-01" },
                ],
            },
            {
                "campaign_name": "แคมเปญยกแพ็ค",
                "data_product": [
                    { "id": 102, "unit": "ขวด [30 เม็ด]", "qty": 6, "discount": 12.5, "discount_type": "baht",
                      "is_buy_pack": 1, "campaign_type": "normal", "campaign_name": "แคมเปญยกแพ็ค" },
                    { "id": 999, "unit": "ชิ้น", "is_giveaway": 1, "discount": 0 },
                ],
            },
            {
                "campaign_name": "ของแถม",
                "text": "ซื้อครบ 500 รับฟรีแก้วน้ำ",
                "data_product": [
                    { "id": 104, "unit": "กล่อง", "qty": 1, "discount": 0, "campaign_type": "giveaway",
                      "campaign_name": "ของแถม", "end_pro": null },
                ],
            },
        ],
    })
}

fn snapshot_flats() -> Value {
    json!([
        { "sku": "S1", "productId": 1, "name": "สินค้าหนึ่ง", "image": "https://img.test/1.jpg",
          "basePrice": 100, "promotionPrice": 80, "unit": "กล่อง", "stock": 7, "tags": ["promotion", "flash_sale"] },
        { "sku": "S2", "productId": 2, "name": "สินค้าสอง", "image": "https://img.test/2.jpg",
          "basePrice": "59", "promotionPrice": null, "unit": "", "stock": 0, "tags": [] },
        { "sku": "S3", "productId": 3, "name": "รูป http", "image": "http://img.test/3.jpg",
          "basePrice": 10, "promotionPrice": 5, "unit": "ซอง", "stock": 2, "tags": ["bestseller"] },
        { "sku": "S4", "productId": 4, "name": "สินค้าสี่", "image": "https://img.test/4.jpg",
          "basePrice": 0, "promotionPrice": null, "unit": "ขวด", "stock": 10, "tags": ["new_arrival"] },
    ])
}

fn promo_flats() -> Vec<Value> {
    json!([
        { "sku": "SKU-101", "productId": 101, "name": "ยาดมสมุนไพร", "image": "https://img.test/101.jpg",
          "basePrice": 120.5, "unit": "หลอด", "tags": ["flash_sale"] },
        { "sku": "SKU-102", "productId": 102, "name": "วิตามินรวม", "image": "https://img.test/102.jpg",
          "basePrice": 731.3299999, "unit": "ขวด [30 เม็ด]", "tags": [] },
        { "sku": "SKU-104", "productId": 104, "name": "นมผง", "image": "https://img.test/104.jpg",
          "basePrice": 500, "unit": "กล่อง", "tags": [] },
        { "sku": "SKU-105", "productId": 105, "name": "ไม่มีโปร", "image": "https://img.test/105.jpg",
          "basePrice": 9, "unit": "ชิ้น", "tags": [] },
    ])
    .as_array()
    .unwrap()
    .clone()
}

fn banner_product() -> Product {
    serde_json::from_value(json!({
        "code": "A100", "name": "วิตามินซี 1000 มก. ขนาดบรรจุใหญ่พิเศษ", "imageUrl": "https://img.test/a.jpg",
        "priceNormal": 990, "priceSale": 731.3299999, "promoType": "flash",
        "badgeText": "ลดแรงส่งท้ายปี", "badgeColor": "#0A84FF",
        "unitText": "ขวด [123]", "stockText": "เหลือ 12 ชิ้น", "note": "ซื้อ 2 แถม 1 วันนี้เท่านั้น",
        "_promo": { "type": "percent", "discount": 26, "endsAt": "2025-02-14" },
    }))
    .unwrap()
}

fn banner_product_min() -> Product {
    serde_json::from_value(json!({
        "code": "", "name": "สินค้าไม่มีราคา", "imageUrl": "", "promoType": "custom",
    }))
    .unwrap()
}

// ---- cny ----------------------------------------------------------------------

#[test]
fn cny_flatten_matches_js() {
    let want = expected();
    let item = raw_cny_page()["product"][0].clone();
    assert_parity(flatten_cny_item(&item), &want["cny"]["flattenedFirstItem"], "cny.flattenedFirstItem");
}

#[test]
fn cny_normalize_matches_js() {
    let want = expected();
    assert_parity(
        products_value(&normalize_from_cny(&raw_cny_page())),
        &want["cny"]["normalizeRawPage"],
        "cny.normalizeRawPage",
    );
    assert_parity(
        products_value(&normalize_from_cny(&json!({ "products": snapshot_flats() }))),
        &want["cny"]["normalizeSnapshot"],
        "cny.normalizeSnapshot",
    );
    assert_parity(
        products_value(&normalize_from_cny(&snapshot_flats())),
        &want["cny"]["normalizeFlatArray"],
        "cny.normalizeFlatArray",
    );
}

#[test]
fn cny_stock_text_edges_match_js() {
    let want = expected();
    let got: Vec<Product> = [5, 10, 11, 0]
        .iter()
        .map(|stock| {
            cny_to_product(&json!({
                "sku": "S", "productId": 9, "name": "n", "image": "https://img.test/s.jpg",
                "basePrice": 10, "promotionPrice": null, "unit": "ชิ้น", "stock": stock, "tags": [],
            }))
        })
        .collect();
    assert_parity(products_value(&got), &want["cny"]["productStockEdge"], "cny.productStockEdge");
}

#[test]
fn cny_filtering_matches_js() {
    let want = expected();
    let products = normalize_from_cny(&snapshot_flats());
    assert_parity(
        products_value(&filter_cny(&products, Some("promotion"), None)),
        &want["cny"]["filtered"]["theme"],
        "cny.filtered.theme",
    );
    assert_parity(
        products_value(&filter_cny(&products, None, Some("สอง"))),
        &want["cny"]["filtered"]["keywords"],
        "cny.filtered.keywords",
    );
    assert_parity(
        products_value(&filter_cny(&products, Some("new_arrival"), Some("s4"))),
        &want["cny"]["filtered"]["both"],
        "cny.filtered.both",
    );
}

// ---- promo ---------------------------------------------------------------------

#[test]
fn promo_extraction_and_join_match_js() {
    let want = expected();
    let map = extract_promotions(&raw_cny_page());

    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort();
    assert_parity(json!(keys), &want["promo"]["promotionKeys"], "promo.promotionKeys");

    assert_parity(
        products_value(&build_promo_products(&promo_flats(), &map)),
        &want["promo"]["products"],
        "promo.products",
    );
}

// ---- compositor ------------------------------------------------------------------

fn opts() -> CompositorOpts {
    CompositorOpts::default()
}

#[test]
fn compositor_banner_plans_match_js() {
    let want = expected();
    let p = banner_product();

    assert_parity(
        serde_json::to_value(build_banner(&p, &opts())).unwrap(),
        &want["compositor"]["bannerClassicSquare"],
        "compositor.bannerClassicSquare",
    );
    assert_parity(
        serde_json::to_value(build_banner(&p, &CompositorOpts {
            size: Some("story".into()),
            template: Some("bold".into()),
            ..opts()
        }))
        .unwrap(),
        &want["compositor"]["bannerBoldStory"],
        "compositor.bannerBoldStory",
    );
    assert_parity(
        serde_json::to_value(build_banner(&p, &CompositorOpts {
            size: Some("line".into()),
            template: Some("cny".into()),
            brand: Some(BrandOverride { accent: Some("#123456".into()), ..Default::default() }),
            ..opts()
        }))
        .unwrap(),
        &want["compositor"]["bannerCnyBranded"],
        "compositor.bannerCnyBranded",
    );
    assert_parity(
        serde_json::to_value(build_banner(&banner_product_min(), &CompositorOpts {
            size: Some("portrait".into()),
            ..opts()
        }))
        .unwrap(),
        &want["compositor"]["bannerMinimalProduct"],
        "compositor.bannerMinimalProduct",
    );
    assert_parity(
        serde_json::to_value(build_banner(&p, &CompositorOpts {
            template: Some("promo".into()),
            ship_free: Some(false),
            ..opts()
        }))
        .unwrap(),
        &want["compositor"]["bannerPromoDelegates"],
        "compositor.bannerPromoDelegates",
    );
}

#[test]
fn compositor_overlay_plans_match_js() {
    let want = expected();
    let p = banner_product();

    assert_parity(
        serde_json::to_value(build_overlay(&p, &opts())).unwrap(),
        &want["compositor"]["overlayDefault"],
        "compositor.overlayDefault",
    );
    assert_parity(
        serde_json::to_value(build_overlay(&p, &CompositorOpts {
            size: Some("story".into()),
            bg_image: Some("https://img.test/scene.jpg".into()),
            cta: Some("ทัก LINE เลย".into()),
            brand: Some(BrandOverride { primary: Some("#112233".into()), ..Default::default() }),
            ..opts()
        }))
        .unwrap(),
        &want["compositor"]["overlayCustom"],
        "compositor.overlayCustom",
    );
    let mut pct_product = banner_product_min();
    pct_product.price_normal = Some(200.0);
    pct_product.price_sale = Some(150.0);
    assert_parity(
        serde_json::to_value(build_overlay(&pct_product, &opts())).unwrap(),
        &want["compositor"]["overlayPctFromPrices"],
        "compositor.overlayPctFromPrices",
    );
}

#[test]
fn compositor_promo_card_plans_match_js() {
    let want = expected();
    assert_parity(
        serde_json::to_value(build_promo_card(&banner_product(), &CompositorOpts {
            logo_url: Some("https://img.test/logo.png".into()),
            contact: Some("โทร 02-000-0000".into()),
            ..opts()
        }))
        .unwrap(),
        &want["compositor"]["promoCardSquare"],
        "compositor.promoCardSquare",
    );
    let bare: Product = serde_json::from_value(json!({
        "code": "", "name": "no price", "imageUrl": "https://img.test/x.jpg", "promoType": "custom",
    }))
    .unwrap();
    assert_parity(
        serde_json::to_value(build_promo_card(&bare, &CompositorOpts {
            size: Some("line".into()),
            ship_free: Some(false),
            ..opts()
        }))
        .unwrap(),
        &want["compositor"]["promoCardLineNoPriceNoCode"],
        "compositor.promoCardLineNoPriceNoCode",
    );
}
