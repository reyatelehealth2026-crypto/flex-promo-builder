//! Flat FFI surface over `prom9_core` for flutter_rust_bridge v2.
//!
//! Conventions used here:
//!   * Mirrored value types (`FfiProduct`, `FfiTemplate`, `FfiValidation`,
//!     `FfiDrawPlan`/`FfiElement`, ...) — plain structs/enums that frb v2
//!     translates 1:1 into Dart classes / sealed classes.
//!   * Flex bubbles/carousels cross the boundary as JSON strings: inside
//!     prom9_core they are `serde_json::Value` shaped byte-for-byte like the
//!     JS builder, so a string keeps the golden-fixture fidelity and avoids a
//!     deep mirrored DOM.
//!   * Everything is `#[frb(sync)]`: all calls are pure CPU and fast
//!     (microseconds–low milliseconds), so synchronous bindings keep the Dart
//!     call sites simple. Fallible functions return `anyhow::Result`, which
//!     frb surfaces as a thrown `AnyhowException` in Dart.

use anyhow::{anyhow, Result};
use flutter_rust_bridge::frb;
use serde_json::Value;

use prom9_core::creative::compositor;
use prom9_core::flex::{builder, validate};
use prom9_core::ingest::{adapters, cny, promo};

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

/// Called automatically by the generated Dart `RustLib.init()`.
#[frb(init)]
pub fn init_app() {
    flutter_rust_bridge::setup_default_user_utils();
}

// ---------------------------------------------------------------------------
// Mirrored types
// ---------------------------------------------------------------------------

/// Mirror of `prom9_core::Product` (serde camelCase on the core side).
#[derive(Debug, Clone, Default)]
pub struct FfiProduct {
    pub code: String,
    pub name: String,
    pub image_url: String,
    pub price_normal: Option<f64>,
    pub price_sale: Option<f64>,
    /// "flash" | "lastlot" | "member" | "custom"
    pub promo_type: String,
    pub badge_text: Option<String>,
    pub badge_color: Option<String>,
    pub expire_text: Option<String>,
    pub stock_text: Option<String>,
    pub points_text: Option<String>,
    pub note: Option<String>,
    pub unit_text: Option<String>,
    /// `_tags` on the core/JS side.
    pub tags: Option<Vec<String>>,
    /// `_promo` on the core/JS side.
    pub promo: Option<FfiPromoInfo>,
}

/// Mirror of `prom9_core::PromoInfo`.
#[derive(Debug, Clone, Default)]
pub struct FfiPromoInfo {
    pub qty: Option<f64>,
    pub unit: Option<String>,
    pub discount: f64,
    /// "percent" | "baht" | "giveaway" (named `type` in the JSON wire shape).
    pub kind: String,
    pub is_buy_pack: bool,
    pub campaign_name: String,
    pub ends_at: Option<String>,
}

/// Mirror of `prom9_core::Template`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum FfiTemplate {
    #[default]
    Classic,
    Promo,
    BigPrice,
    Minimal,
    Urgent,
}

/// Mirror of `prom9_core::flex::validate::Validation`.
#[derive(Debug, Clone, Default)]
pub struct FfiValidation {
    pub ok: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub bytes: u64,
}

/// Result of `preset()` — badge text + color for a promo type.
#[derive(Debug, Clone)]
pub struct FfiPresetBadge {
    pub text: String,
    pub color: String,
}

/// Canvas dimensions resolved from a size key.
#[derive(Debug, Clone, Copy)]
pub struct FfiCanvasSize {
    pub width: u32,
    pub height: u32,
}

/// Mirror of `compositor::BrandOverride`.
#[derive(Debug, Clone, Default)]
pub struct FfiBrandOverride {
    pub primary: Option<String>,
    pub accent: Option<String>,
    pub ink: Option<String>,
    pub bg: Option<String>,
}

/// Mirror of `compositor::CompositorOpts`.
#[derive(Debug, Clone, Default)]
pub struct FfiCompositorOpts {
    /// "square" | "portrait" | "story" | "line" (default "square").
    pub size: Option<String>,
    /// banner: "classic" (default) | "bold" | "cny" | "promo".
    pub template: Option<String>,
    pub brand: Option<FfiBrandOverride>,
    pub logo_url: Option<String>,
    pub contact: Option<String>,
    /// Only an explicit `false` hides the ส่งฟรี pill.
    pub ship_free: Option<bool>,
    pub bg_image: Option<String>,
    pub cta: Option<String>,
}

/// Mirror of `compositor::Element` — one draw op. frb v2 turns this into a
/// Dart sealed class hierarchy (`FfiElement_Rect`, `FfiElement_Image`, ...).
#[derive(Debug, Clone)]
pub enum FfiElement {
    Rect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        fill: String,
        radius: Option<f64>,
    },
    Image {
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
        /// "bold" | "normal"
        weight: String,
        /// "left" | "center" | "right"
        align: String,
        strike: Option<bool>,
        max_width: Option<f64>,
    },
    Burst {
        cx: f64,
        cy: f64,
        r_outer: f64,
        r_inner: f64,
        points: u32,
        fill: String,
    },
}

/// Mirror of `compositor::DrawPlan`.
#[derive(Debug, Clone)]
pub struct FfiDrawPlan {
    pub width: u32,
    pub height: u32,
    pub background: String,
    pub elements: Vec<FfiElement>,
}

// ---------------------------------------------------------------------------
// Conversions (not part of the FFI surface)
// ---------------------------------------------------------------------------

impl From<FfiPromoInfo> for builder::PromoInfo {
    fn from(p: FfiPromoInfo) -> Self {
        builder::PromoInfo {
            qty: p.qty,
            unit: p.unit,
            discount: p.discount,
            kind: p.kind,
            is_buy_pack: p.is_buy_pack,
            campaign_name: p.campaign_name,
            ends_at: p.ends_at,
        }
    }
}

impl From<builder::PromoInfo> for FfiPromoInfo {
    fn from(p: builder::PromoInfo) -> Self {
        FfiPromoInfo {
            qty: p.qty,
            unit: p.unit,
            discount: p.discount,
            kind: p.kind,
            is_buy_pack: p.is_buy_pack,
            campaign_name: p.campaign_name,
            ends_at: p.ends_at,
        }
    }
}

impl From<FfiProduct> for builder::Product {
    fn from(p: FfiProduct) -> Self {
        builder::Product {
            code: p.code,
            name: p.name,
            image_url: p.image_url,
            price_normal: p.price_normal,
            price_sale: p.price_sale,
            promo_type: p.promo_type,
            badge_text: p.badge_text,
            badge_color: p.badge_color,
            expire_text: p.expire_text,
            stock_text: p.stock_text,
            points_text: p.points_text,
            note: p.note,
            unit_text: p.unit_text,
            tags: p.tags,
            promo: p.promo.map(Into::into),
        }
    }
}

impl From<builder::Product> for FfiProduct {
    fn from(p: builder::Product) -> Self {
        FfiProduct {
            code: p.code,
            name: p.name,
            image_url: p.image_url,
            price_normal: p.price_normal,
            price_sale: p.price_sale,
            promo_type: p.promo_type,
            badge_text: p.badge_text,
            badge_color: p.badge_color,
            expire_text: p.expire_text,
            stock_text: p.stock_text,
            points_text: p.points_text,
            note: p.note,
            unit_text: p.unit_text,
            tags: p.tags,
            promo: p.promo.map(Into::into),
        }
    }
}

impl From<FfiTemplate> for builder::Template {
    fn from(t: FfiTemplate) -> Self {
        match t {
            FfiTemplate::Classic => builder::Template::Classic,
            FfiTemplate::Promo => builder::Template::Promo,
            FfiTemplate::BigPrice => builder::Template::BigPrice,
            FfiTemplate::Minimal => builder::Template::Minimal,
            FfiTemplate::Urgent => builder::Template::Urgent,
        }
    }
}

impl From<builder::Template> for FfiTemplate {
    fn from(t: builder::Template) -> Self {
        match t {
            builder::Template::Classic => FfiTemplate::Classic,
            builder::Template::Promo => FfiTemplate::Promo,
            builder::Template::BigPrice => FfiTemplate::BigPrice,
            builder::Template::Minimal => FfiTemplate::Minimal,
            builder::Template::Urgent => FfiTemplate::Urgent,
        }
    }
}

impl From<validate::Validation> for FfiValidation {
    fn from(v: validate::Validation) -> Self {
        FfiValidation {
            ok: v.ok,
            errors: v.errors,
            warnings: v.warnings,
            bytes: v.bytes as u64,
        }
    }
}

impl From<FfiBrandOverride> for compositor::BrandOverride {
    fn from(b: FfiBrandOverride) -> Self {
        compositor::BrandOverride {
            primary: b.primary,
            accent: b.accent,
            ink: b.ink,
            bg: b.bg,
        }
    }
}

impl From<FfiCompositorOpts> for compositor::CompositorOpts {
    fn from(o: FfiCompositorOpts) -> Self {
        compositor::CompositorOpts {
            size: o.size,
            template: o.template,
            brand: o.brand.map(Into::into),
            logo_url: o.logo_url,
            contact: o.contact,
            ship_free: o.ship_free,
            bg_image: o.bg_image,
            cta: o.cta,
        }
    }
}

impl From<compositor::Element> for FfiElement {
    fn from(e: compositor::Element) -> Self {
        match e {
            compositor::Element::Rect { x, y, w, h, fill, radius } => {
                FfiElement::Rect { x, y, w, h, fill, radius }
            }
            compositor::Element::Image { src, x, y, w, h, fit } => {
                FfiElement::Image { src, x, y, w, h, fit }
            }
            compositor::Element::Text { text, x, y, size, color, weight, align, strike, max_width } => {
                FfiElement::Text { text, x, y, size, color, weight, align, strike, max_width }
            }
            compositor::Element::Burst { cx, cy, r_outer, r_inner, points, fill } => {
                FfiElement::Burst { cx, cy, r_outer, r_inner, points, fill }
            }
        }
    }
}

impl From<compositor::DrawPlan> for FfiDrawPlan {
    fn from(p: compositor::DrawPlan) -> Self {
        FfiDrawPlan {
            width: p.width,
            height: p.height,
            background: p.background,
            elements: p.elements.into_iter().map(Into::into).collect(),
        }
    }
}

fn parse_json(label: &str, s: &str) -> Result<Value> {
    serde_json::from_str(s).map_err(|e| anyhow!("invalid {label} JSON: {e}"))
}

fn to_json_string(v: &Value) -> String {
    serde_json::to_string(v).expect("Value serialization cannot fail")
}

// ---------------------------------------------------------------------------
// flex::builder
// ---------------------------------------------------------------------------

/// Build a single bubble; returns compact LINE Flex JSON.
#[frb(sync)]
pub fn build_bubble_json(product: FfiProduct, template: FfiTemplate) -> String {
    let bubble = builder::build_bubble(&product.into(), template.into());
    to_json_string(&bubble)
}

/// Build one carousel (errors above 12 bubbles with the JS-identical message).
#[frb(sync)]
pub fn build_carousel_json(products: Vec<FfiProduct>, template: FfiTemplate) -> Result<String> {
    let products: Vec<builder::Product> = products.into_iter().map(Into::into).collect();
    let carousel = builder::build_carousel(&products, template.into()).map_err(|e| anyhow!(e))?;
    Ok(to_json_string(&carousel))
}

/// Auto-split into carousels of <= 12 bubbles each (never errors).
#[frb(sync)]
pub fn build_carousels_json(products: Vec<FfiProduct>, template: FfiTemplate) -> Vec<String> {
    let products: Vec<builder::Product> = products.into_iter().map(Into::into).collect();
    builder::build_carousels(&products, template.into())
        .iter()
        .map(to_json_string)
        .collect()
}

/// Wrap a carousel in the Messaging API flex envelope. Empty/None `alt_text`
/// falls back to "โปรโมชั่นสินค้า".
#[frb(sync)]
pub fn build_flex_message_json(carousel_json: String, alt_text: Option<String>) -> Result<String> {
    let carousel = parse_json("carousel", &carousel_json)?;
    let msg = builder::build_flex_message(&carousel, alt_text.as_deref());
    Ok(to_json_string(&msg))
}

/// flex-builder `money()` ("26.6", drops ".00" and one trailing zero).
#[frb(sync)]
pub fn flex_money(n: f64) -> String {
    builder::money(n)
}

/// Preset badge (text + color) for "flash" | "lastlot" | "member" | "custom".
#[frb(sync)]
pub fn preset_badge(promo_type: String) -> Option<FfiPresetBadge> {
    builder::preset(&promo_type).map(|(text, color)| FfiPresetBadge {
        text: text.to_string(),
        color: color.to_string(),
    })
}

/// `Template::parse` — unknown names fall back to Classic.
#[frb(sync)]
pub fn parse_template(name: String) -> FfiTemplate {
    builder::Template::parse(&name).into()
}

/// Carousel bubble cap (12).
#[frb(sync)]
pub fn max_bubbles() -> u32 {
    builder::MAX_BUBBLES as u32
}

// ---------------------------------------------------------------------------
// flex::validate
// ---------------------------------------------------------------------------

/// Validate a carousel JSON payload (12-bubble cap, 50KB, https hero, labels).
#[frb(sync)]
pub fn validate_carousel_json(carousel_json: String) -> Result<FfiValidation> {
    let carousel = parse_json("carousel", &carousel_json)?;
    Ok(validate::validate(&carousel).into())
}

/// Hard payload limit (50 * 1024 bytes).
#[frb(sync)]
pub fn max_payload_bytes() -> u64 {
    validate::MAX_BYTES as u64
}

/// Warning threshold (45 * 1024 bytes).
#[frb(sync)]
pub fn warn_payload_bytes() -> u64 {
    validate::WARN_BYTES as u64
}

/// "512 B" / "48.9 KB" with JS toFixed(1) semantics.
#[frb(sync)]
pub fn fmt_bytes(n: u64) -> String {
    validate::fmt_bytes(n as usize)
}

// ---------------------------------------------------------------------------
// ingest
// ---------------------------------------------------------------------------

/// Google Sheet URL or bare spreadsheet id -> gviz CSV export URL.
#[frb(sync)]
pub fn sheet_csv_url(input: String, sheet_name: Option<String>) -> Result<String> {
    adapters::sheet_csv_url(&input, sheet_name.as_deref()).map_err(|e| anyhow!(e))
}

/// Normalize a Sheet CSV export into products (unusable rows filtered out).
#[frb(sync)]
pub fn products_from_csv(text: String) -> Vec<FfiProduct> {
    adapters::normalize_from_csv(&text).into_iter().map(Into::into).collect()
}

/// Normalize a JSON payload (bare array, `{products: [...]}` or one object).
#[frb(sync)]
pub fn products_from_json(text: String) -> Result<Vec<FfiProduct>> {
    let products = adapters::normalize_from_json_str(&text).map_err(|e| anyhow!(e))?;
    Ok(products.into_iter().map(Into::into).collect())
}

/// Normalize a cnypharmacy catalog API payload (single page or page array).
#[frb(sync)]
pub fn products_from_cny(text: String) -> Result<Vec<FfiProduct>> {
    let products = cny::normalize_from_cny_str(&text).map_err(|e| anyhow!(e))?;
    Ok(products.into_iter().map(Into::into).collect())
}

/// CNY theme/keyword filter.
#[frb(sync)]
pub fn filter_cny_products(
    products: Vec<FfiProduct>,
    theme: Option<String>,
    keywords: Option<String>,
) -> Vec<FfiProduct> {
    let products: Vec<builder::Product> = products.into_iter().map(Into::into).collect();
    cny::filter_cny(&products, theme.as_deref(), keywords.as_deref())
        .into_iter()
        .map(Into::into)
        .collect()
}

/// Join flattened catalog items (JSON array) with a promotion API response:
/// `extract_promotions` + `build_promo_products` in one call.
#[frb(sync)]
pub fn promo_products_from_api(
    flats_json: String,
    promo_api_response_json: String,
) -> Result<Vec<FfiProduct>> {
    let flats = parse_json("flats", &flats_json)?;
    let flats = flats
        .as_array()
        .ok_or_else(|| anyhow!("flats JSON must be an array"))?;
    let api = parse_json("promotion API response", &promo_api_response_json)?;
    let promo_map = promo::extract_promotions(&api);
    Ok(promo::build_promo_products(flats, &promo_map)
        .into_iter()
        .map(Into::into)
        .collect())
}

// ---------------------------------------------------------------------------
// creative::compositor
// ---------------------------------------------------------------------------

/// Banner draw plan ("classic" | "bold" | "cny"; "promo" delegates to the card).
#[frb(sync)]
pub fn banner_plan(product: FfiProduct, opts: FfiCompositorOpts) -> FfiDrawPlan {
    compositor::build_banner(&product.into(), &opts.into()).into()
}

/// Text-overlay draw plan (crisp promo text over a full-bleed image).
#[frb(sync)]
pub fn overlay_plan(product: FfiProduct, opts: FfiCompositorOpts) -> FfiDrawPlan {
    compositor::build_overlay(&product.into(), &opts.into()).into()
}

/// SPECIAL PROMO card draw plan (gold card with starburst seal).
#[frb(sync)]
pub fn promo_card_plan(product: FfiProduct, opts: FfiCompositorOpts) -> FfiDrawPlan {
    compositor::build_promo_card(&product.into(), &opts.into()).into()
}

/// Resolve a size key ("square" | "portrait" | "story" | "line"); unknown ->
/// square 1080x1080.
#[frb(sync)]
pub fn canvas_size(key: Option<String>) -> FfiCanvasSize {
    let (width, height) = compositor::size_for(key.as_deref());
    FfiCanvasSize { width, height }
}

/// Compositor `money()` (keeps two decimals: "26.60"; non-finite -> "0").
#[frb(sync)]
pub fn compositor_money(n: f64) -> String {
    compositor::money(n)
}
