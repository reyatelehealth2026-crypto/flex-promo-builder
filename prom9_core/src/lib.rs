//! prom9_core — Rust core for the Prom9 migration (Phase 2 of ROADMAP.md).
//!
//! Ports of the pure ES modules in `lib/`:
//!   - `flex::builder`        <- lib/flex-builder.js (5 bubble templates)
//!   - `flex::validate`       <- lib/validate.js
//!   - `ingest::adapters`     <- lib/adapters.js (Sheet CSV / JSON -> Product)
//!   - `ingest::cny`          <- lib/cny.js (CNY catalog API / cache snapshot)
//!   - `ingest::promo`        <- lib/promo.js (campaign join + condition text)
//!   - `creative::compositor` <- lib/compositor.js (banner draw plans)
//!
//! All Flex output is `serde_json::Value` shaped byte-for-byte like the JS
//! builder; `test/golden/fixtures.json` at the repo root is the shared golden
//! reference (see tests/golden.rs).

pub mod creative;
pub mod flex;
pub mod ingest;
mod jsutil;

pub use flex::builder::{
    build_bubble, build_carousel, build_carousels, build_flex_message, Product, PromoInfo,
    Template, MAX_BUBBLES,
};
pub use flex::validate::{validate, Validation};
