//! rust_lib_prom9 — flutter_rust_bridge (v2) FFI layer over `prom9_core`.
//!
//! This crate exposes a flat, frb-friendly API (see `api::prom9`): plain
//! functions over mirrored structs/enums plus JSON strings for the Flex
//! bubble payloads (which are `serde_json::Value` inside prom9_core anyway).
//!
//! `frb_generated.rs` is a placeholder that keeps `cargo check` green until
//! `flutter_rust_bridge_codegen generate` overwrites it (see app/README.md).

pub mod api;
mod frb_generated;
