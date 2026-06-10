/// Mirror of `prom9_core::Product` / `FfiProduct` (serde camelCase wire shape,
/// with `_tags` / `_promo` like lib/adapters.js).
class Product {
  const Product({
    required this.code,
    required this.name,
    required this.imageUrl,
    this.priceNormal,
    this.priceSale,
    this.promoType = 'custom',
    this.badgeText,
    this.badgeColor,
    this.expireText,
    this.stockText,
    this.pointsText,
    this.note,
    this.unitText,
    this.tags,
    this.promo,
  });

  final String code;
  final String name;
  final String imageUrl;
  final double? priceNormal;
  final double? priceSale;

  /// 'flash' | 'lastlot' | 'member' | 'custom'
  final String promoType;
  final String? badgeText;
  final String? badgeColor;
  final String? expireText;
  final String? stockText;
  final String? pointsText;
  final String? note;
  final String? unitText;

  /// `_tags` on the wire.
  final List<String>? tags;

  /// `_promo` on the wire.
  final PromoInfo? promo;

  /// Effective price shown in lists (sale wins over normal).
  double? get effectivePrice => priceSale ?? priceNormal;

  bool get hasDiscount =>
      priceNormal != null && priceSale != null && priceNormal! > priceSale!;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'code': code,
        'name': name,
        'imageUrl': imageUrl,
        if (priceNormal != null) 'priceNormal': priceNormal,
        if (priceSale != null) 'priceSale': priceSale,
        'promoType': promoType,
        if (badgeText != null) 'badgeText': badgeText,
        if (badgeColor != null) 'badgeColor': badgeColor,
        if (expireText != null) 'expireText': expireText,
        if (stockText != null) 'stockText': stockText,
        if (pointsText != null) 'pointsText': pointsText,
        if (note != null) 'note': note,
        if (unitText != null) 'unitText': unitText,
        if (tags != null) '_tags': tags,
        if (promo != null) '_promo': promo!.toJson(),
      };

  factory Product.fromJson(Map<String, dynamic> json) => Product(
        code: (json['code'] ?? '') as String,
        name: (json['name'] ?? '') as String,
        imageUrl: (json['imageUrl'] ?? '') as String,
        priceNormal: (json['priceNormal'] as num?)?.toDouble(),
        priceSale: (json['priceSale'] as num?)?.toDouble(),
        promoType: (json['promoType'] ?? 'custom') as String,
        badgeText: json['badgeText'] as String?,
        badgeColor: json['badgeColor'] as String?,
        expireText: json['expireText'] as String?,
        stockText: json['stockText'] as String?,
        pointsText: json['pointsText'] as String?,
        note: json['note'] as String?,
        unitText: json['unitText'] as String?,
        tags: (json['_tags'] as List<dynamic>?)?.cast<String>(),
        promo: json['_promo'] == null
            ? null
            : PromoInfo.fromJson(json['_promo'] as Map<String, dynamic>),
      );
}

/// Mirror of `prom9_core::PromoInfo` (`_promo` metadata from lib/promo.js).
class PromoInfo {
  const PromoInfo({
    this.qty,
    this.unit,
    this.discount = 0,
    this.kind = 'percent',
    this.isBuyPack = false,
    this.campaignName = '',
    this.endsAt,
  });

  final double? qty;
  final String? unit;
  final double discount;

  /// 'percent' | 'baht' | 'giveaway' — serialized as `type`.
  final String kind;
  final bool isBuyPack;
  final String campaignName;
  final String? endsAt;

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (qty != null) 'qty': qty,
        if (unit != null) 'unit': unit,
        'discount': discount,
        'type': kind,
        'isBuyPack': isBuyPack,
        'campaignName': campaignName,
        'endsAt': endsAt,
      };

  factory PromoInfo.fromJson(Map<String, dynamic> json) => PromoInfo(
        qty: (json['qty'] as num?)?.toDouble(),
        unit: json['unit'] as String?,
        discount: ((json['discount'] ?? 0) as num).toDouble(),
        kind: (json['type'] ?? 'percent') as String,
        isBuyPack: (json['isBuyPack'] ?? false) as bool,
        campaignName: (json['campaignName'] ?? '') as String,
        endsAt: json['endsAt'] as String?,
      );
}

/// Promo types known by the adapters (`PROMO_TYPES` in lib/adapters.js).
const List<String> kPromoTypes = ['flash', 'lastlot', 'member', 'custom'];

/// Thai display labels for the filter chips.
const Map<String, String> kPromoTypeLabels = {
  'flash': '⚡ Flash Sale',
  'lastlot': '🔥 ล็อตสุดท้าย',
  'member': '💎 สมาชิก',
  'custom': 'โปรพิเศษ',
};
