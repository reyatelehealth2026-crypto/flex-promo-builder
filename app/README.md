# Prom9 — Flutter prototype (Phase 3)

Flutter app over the Phase-2 Rust core (`../prom9_core`) via
**flutter_rust_bridge v2**. Features: Product Hub (FTS5 search, filter,
multi-select), Flex bubble preview, export + validation, and a CustomPainter
card renderer that replaces the Electron offscreen-Chromium pipeline.

```
app/
├─ pubspec.yaml                  Flutter deps (riverpod, frb v2, sqlite3, ...)
├─ flutter_rust_bridge.yaml      frb codegen config (scans rust/src/api)
├─ rust/                         FFI crate: rust_lib_prom9 -> ../prom9_core
│  └─ src/api/prom9.rs           the flat #[frb(sync)] API surface
└─ lib/
   ├─ main.dart                  bridge init + DB open/seed + ProviderScope
   ├─ core/                      models mirroring the bridge types, theme
   ├─ data/
   │  ├─ bridge/                 Prom9Api interface + *.stub.dart placeholder
   │  └─ db/                     SQLite schema (FTS5 + triggers) + DAO
   └─ features/
      ├─ product_hub/            list + debounced search + chips + multi-select
      ├─ preview/                Flex bubble JSON -> Flutter widget renderer
      ├─ export/                 pretty JSON, copy/share, validation panel
      └─ card_renderer/          DrawPlan CustomPainter + batch PNG export
```

## Status / what is generated vs. hand-written

This tree was authored in a container **without** the Flutter/Dart SDK, so:

* `app/rust` **passes `cargo check`** (verified) — the crate is real.
* The Dart code is complete and internally consistent but has not been
  compiled here.
* `lib/data/bridge/prom9_api.stub.dart` is a **placeholder** that lets the
  whole app compile and run before codegen: `Prom9Api` is the interface the
  generated bindings will satisfy (via a thin adapter), `Prom9ApiStub` throws
  `BridgeUnavailable` on use (the UI catches it and shows the reason).
* `rust/src/frb_generated.rs` is an empty placeholder that
  `flutter_rust_bridge_codegen` overwrites.
* The Flutter platform folders (`android/`, `ios/`, `linux/`, ...) are not
  checked in; `flutter create` plumbs them (step 1 below).

## Local setup (exact steps)

Prereqs: Flutter ≥ 3.24 (Dart ≥ 3.5), Rust stable, and for desktop Linux:
`libsqlite3-dev` is NOT needed (sqlite3_flutter_libs bundles SQLite), but the
usual `flutter doctor` toolchains are.

```bash
cd app

# 1) Plumb the platform folders into this existing project (pick platforms).
flutter create . --project-name prom9_app --platforms=android,ios,macos,linux,windows

# 2) Fetch Dart deps.
flutter pub get

# 3) Install the codegen CLI — version MUST match the flutter_rust_bridge
#    version that pub + cargo resolved (check pubspec.lock / rust/Cargo.lock;
#    cargo resolved 2.12.0 at authoring time).
cargo install flutter_rust_bridge_codegen --version 2.12.0 --locked

# 4) Generate the bindings (reads flutter_rust_bridge.yaml):
#    - overwrites rust/src/frb_generated.rs
#    - writes   lib/data/bridge/generated/  (RustLib + api classes)
flutter_rust_bridge_codegen generate

# 5) Wire the generated bindings in: implement GeneratedProm9Api following
#    the recipe in lib/data/bridge/prom9_api.stub.dart (call RustLib.init(),
#    delegate each method, map Ffi* <-> core models — field names match),
#    then in lib/data/bridge/bridge_service.dart change
#        final Prom9Api prom9Api = Prom9ApiStub();
#    to  final Prom9Api prom9Api = GeneratedProm9Api();

# 6) Build the native library + run. For mobile/desktop dev builds frb's
#    cargokit (wired by `flutter_rust_bridge_codegen integrate`, or add the
#    rust builder to the platform projects per frb docs) compiles rust/
#    automatically; quickest manual check on desktop:
cargo build --manifest-path rust/Cargo.toml --release
flutter run -d linux        # or -d macos / -d windows / a device

# Sanity checks
flutter analyze
cargo check --manifest-path rust/Cargo.toml
```

Note on step 6: if you prefer the fully-automated native build, run
`flutter_rust_bridge_codegen integrate` once — it injects the cargokit Gradle/
Xcode/CMake glue into the platform folders created in step 1. (It may also
re-create template files; keep ours on conflict.)

## Package choices (and why)

| Package | Why |
| --- | --- |
| `flutter_rust_bridge ^2` | The roadmap's chosen FFI layer; v2 gives sync calls, mirrored structs, sealed-class enums (perfect for the `Element` draw ops). |
| `sqlite3` + `sqlite3_flutter_libs` | **FTS5 guaranteed**: bundles a current SQLite compiled with FTS5 on every platform, unlike sqflite which links the OS SQLite (FTS5 varies by Android/iOS version). Synchronous FFI also makes the 10k-SKU batch insert (1 transaction + 1 prepared statement) fast with zero platform-channel overhead. Drift was considered (it sits on the same package) but raw SQL keeps the FTS5 virtual table + triggers explicit. |
| `flutter_riverpod` | Search query + filter + selection compose into one derived provider; trivially overridable for tests (`productDaoProvider` is injected in `main`). |
| `share_plus`, `path_provider`, `path` | OS share sheet for exported JSON; DB/PNG file locations. |

## Search notes

`products_fts` is an external-content FTS5 table (code, name, note, tags)
synced by triggers. Queries use per-token prefix matching
(`"vita"* "c1"*`, bm25-ranked). Because `unicode61` does not segment unspaced
Thai, the DAO falls back to a `LIKE %q%` scan when FTS yields nothing — codes
and spaced text hit the index, Thai substrings still work.

## Card renderer notes

`prom9_core` compositor plans are pure data (`{width, height, background,
elements}`); `DrawPlanPainter` executes them (rect+radius, image cover/contain
with placeholder, text with align/strike/maxWidth-ellipsis, burst star
polygon). Text `y` is interpreted as the vertical center of the first line
(canvas `textBaseline:'middle'` semantics) — see the painter header.
`CardRenderService.renderBatch` renders N products concurrently (bounded
worker pool; rasterization stays on the UI isolate since `dart:ui` objects
are not isolate-sendable, network fetches overlap) and writes PNGs — the
offscreen-Chromium replacement from the roadmap.
