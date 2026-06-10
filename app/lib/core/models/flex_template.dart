/// Mirror of `prom9_core::Template` / `FfiTemplate`.
enum FlexTemplate {
  classic,
  promo,
  bigPrice,
  minimal,
  urgent;

  /// Wire name used by the JS/Rust builders.
  String get wireName => switch (this) {
        FlexTemplate.classic => 'classic',
        FlexTemplate.promo => 'promo',
        FlexTemplate.bigPrice => 'bigprice',
        FlexTemplate.minimal => 'minimal',
        FlexTemplate.urgent => 'urgent',
      };

  String get label => switch (this) {
        FlexTemplate.classic => 'Classic',
        FlexTemplate.promo => 'Special Promo',
        FlexTemplate.bigPrice => 'ราคาเด่น',
        FlexTemplate.minimal => 'มินิมอล',
        FlexTemplate.urgent => 'เร่งด่วน',
      };

  /// `Template::parse` — unknown names fall back to classic, like the core.
  static FlexTemplate parse(String name) => switch (name) {
        'promo' => FlexTemplate.promo,
        'bigprice' => FlexTemplate.bigPrice,
        'minimal' => FlexTemplate.minimal,
        'urgent' => FlexTemplate.urgent,
        _ => FlexTemplate.classic,
      };
}
