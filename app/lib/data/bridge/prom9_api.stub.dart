// ============================================================================
// PLACEHOLDER until `flutter_rust_bridge_codegen generate` produces the real
// bindings (configured in app/flutter_rust_bridge.yaml; output lands in
// lib/data/bridge/generated/).
//
// [Prom9Api] is the app-facing interface, expressed in the app's own model
// types (lib/core/models/). Method names/signatures mirror the Rust functions
// in app/rust/src/api/prom9.rs one-to-one, so after codegen you write a thin
// adapter `GeneratedProm9Api implements Prom9Api` that:
//   1. calls `await RustLib.init()` in [init],
//   2. delegates each method to the generated top-level function of the same
//      (camelCased) name, converting between the generated Ffi* classes and
//      the core models (field names match exactly),
// then swap the single `Prom9ApiStub()` instantiation in bridge_service.dart
// for `GeneratedProm9Api()`. Nothing else in the app changes.
//
// [Prom9ApiStub] lets the whole app compile and run BEFORE codegen: init is a
// no-op and every call throws [BridgeUnavailable] (caught by the UI and shown
// as a snackbar).
// ============================================================================

import 'package:flutter/foundation.dart';

import '../../core/models/models.dart';

/// Thrown by [Prom9ApiStub] for every call — the Rust bindings have not been
/// generated yet.
class BridgeUnavailable extends Error {
  BridgeUnavailable(this.method);

  final String method;

  @override
  String toString() =>
      'BridgeUnavailable: $method — run `flutter_rust_bridge_codegen '
      'generate` and wire GeneratedProm9Api (see prom9_api.stub.dart).';
}

/// Interface over the Rust FFI surface (app/rust/src/api/prom9.rs).
///
/// All methods are synchronous, matching the `#[frb(sync)]` Rust functions;
/// only [init] is async (it loads the dynamic library).
abstract class Prom9Api {
  /// Load the native library / `RustLib.init()`. Must complete before any
  /// other call.
  Future<void> init();

  // ---- flex::builder -------------------------------------------------------

  /// `build_bubble_json` — one bubble as compact LINE Flex JSON.
  String buildBubbleJson({required Product product, required FlexTemplate template});

  /// `build_carousel_json` — throws above 12 bubbles (JS-identical message).
  String buildCarouselJson({required List<Product> products, required FlexTemplate template});

  /// `build_carousels_json` — auto-split into <=12-bubble carousels.
  List<String> buildCarouselsJson({required List<Product> products, required FlexTemplate template});

  /// `build_flex_message_json` — wrap a carousel in the flex envelope.
  String buildFlexMessageJson({required String carouselJson, String? altText});

  /// `flex_money` — "26.6" style (drops ".00" + one trailing zero).
  String flexMoney(double n);

  /// `preset_badge` — badge text/color for a promo type, null for unknown.
  PresetBadge? presetBadge(String promoType);

  /// `parse_template` — unknown names fall back to classic.
  FlexTemplate parseTemplate(String name);

  /// `max_bubbles` — 12.
  int maxBubbles();

  // ---- flex::validate ------------------------------------------------------

  /// `validate_carousel_json` — {ok, errors, warnings, bytes}.
  FlexValidation validateCarouselJson({required String carouselJson});

  /// `max_payload_bytes` — 50 * 1024.
  int maxPayloadBytes();

  /// `warn_payload_bytes` — 45 * 1024.
  int warnPayloadBytes();

  /// `fmt_bytes` — "512 B" / "48.9 KB".
  String fmtBytes(int n);

  // ---- ingest --------------------------------------------------------------

  /// `sheet_csv_url` — Sheet URL / bare id -> gviz CSV export URL.
  String sheetCsvUrl({required String input, String? sheetName});

  /// `products_from_csv` — normalize a Sheet CSV export.
  List<Product> productsFromCsv(String text);

  /// `products_from_json` — bare array, `{products:[...]}` or one object.
  List<Product> productsFromJson(String text);

  /// `products_from_cny` — cnypharmacy catalog payload.
  List<Product> productsFromCny(String text);

  /// `filter_cny_products` — CNY theme/keyword filter.
  List<Product> filterCnyProducts({required List<Product> products, String? theme, String? keywords});

  /// `promo_products_from_api` — join flat items with the promotion API.
  List<Product> promoProductsFromApi({required String flatsJson, required String promoApiResponseJson});

  // ---- creative::compositor ------------------------------------------------

  /// `banner_plan` — classic/bold/cny banner ('promo' delegates to the card).
  DrawPlan bannerPlan({required Product product, required CompositorOpts opts});

  /// `overlay_plan` — promo text over a full-bleed image.
  DrawPlan overlayPlan({required Product product, required CompositorOpts opts});

  /// `promo_card_plan` — the gold SPECIAL PROMO card.
  DrawPlan promoCardPlan({required Product product, required CompositorOpts opts});

  /// `canvas_size` — size key -> dimensions (unknown -> 1080x1080).
  CanvasSize canvasSize(String? key);

  /// `compositor_money` — "26.60" style (keeps two decimals).
  String compositorMoney(double n);
}

/// Compile-time stand-in; replace with `GeneratedProm9Api` after codegen.
class Prom9ApiStub implements Prom9Api {
  @override
  Future<void> init() async {
    debugPrint(
      'Prom9ApiStub active: Rust bindings not generated yet. '
      'Flex/compositor actions will fail until codegen runs (see README.md).',
    );
  }

  Never _missing(String method) => throw BridgeUnavailable(method);

  @override
  String buildBubbleJson({required Product product, required FlexTemplate template}) =>
      _missing('buildBubbleJson');

  @override
  String buildCarouselJson({required List<Product> products, required FlexTemplate template}) =>
      _missing('buildCarouselJson');

  @override
  List<String> buildCarouselsJson({required List<Product> products, required FlexTemplate template}) =>
      _missing('buildCarouselsJson');

  @override
  String buildFlexMessageJson({required String carouselJson, String? altText}) =>
      _missing('buildFlexMessageJson');

  @override
  String flexMoney(double n) => _missing('flexMoney');

  @override
  PresetBadge? presetBadge(String promoType) => _missing('presetBadge');

  @override
  FlexTemplate parseTemplate(String name) => FlexTemplate.parse(name);

  @override
  int maxBubbles() => FlexValidation.maxBubbles;

  @override
  FlexValidation validateCarouselJson({required String carouselJson}) =>
      _missing('validateCarouselJson');

  @override
  int maxPayloadBytes() => FlexValidation.maxBytes;

  @override
  int warnPayloadBytes() => FlexValidation.warnBytes;

  @override
  String fmtBytes(int n) => FlexValidation.fmtBytes(n);

  @override
  String sheetCsvUrl({required String input, String? sheetName}) => _missing('sheetCsvUrl');

  @override
  List<Product> productsFromCsv(String text) => _missing('productsFromCsv');

  @override
  List<Product> productsFromJson(String text) => _missing('productsFromJson');

  @override
  List<Product> productsFromCny(String text) => _missing('productsFromCny');

  @override
  List<Product> filterCnyProducts({required List<Product> products, String? theme, String? keywords}) =>
      _missing('filterCnyProducts');

  @override
  List<Product> promoProductsFromApi({required String flatsJson, required String promoApiResponseJson}) =>
      _missing('promoProductsFromApi');

  @override
  DrawPlan bannerPlan({required Product product, required CompositorOpts opts}) =>
      _missing('bannerPlan');

  @override
  DrawPlan overlayPlan({required Product product, required CompositorOpts opts}) =>
      _missing('overlayPlan');

  @override
  DrawPlan promoCardPlan({required Product product, required CompositorOpts opts}) =>
      _missing('promoCardPlan');

  @override
  CanvasSize canvasSize(String? key) => switch (key) {
        'portrait' => const CanvasSize(width: 1080, height: 1350),
        'story' => const CanvasSize(width: 1080, height: 1920),
        'line' => const CanvasSize(width: 1040, height: 1040),
        _ => const CanvasSize(width: 1080, height: 1080),
      };

  @override
  String compositorMoney(double n) => _missing('compositorMoney');
}
