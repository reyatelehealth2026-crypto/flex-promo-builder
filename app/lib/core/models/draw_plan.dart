/// Mirrors of the `prom9_core::creative::compositor` types
/// (`FfiDrawPlan` / `FfiElement` / `FfiCompositorOpts` on the bridge).
library;

/// `{ width, height, background, elements }` — pure draw data, no drawing.
class DrawPlan {
  const DrawPlan({
    required this.width,
    required this.height,
    required this.background,
    required this.elements,
  });

  final int width;
  final int height;

  /// Hex color, e.g. '#FFC400'.
  final String background;
  final List<DrawElement> elements;
}

/// One draw operation. Mirrors the Rust `Element` enum; frb v2 generates a
/// sealed class hierarchy with the same shape.
sealed class DrawElement {
  const DrawElement();
}

/// `{ type:'rect', x,y,w,h, fill, radius? }`
class RectElement extends DrawElement {
  const RectElement({
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    required this.fill,
    this.radius,
  });

  final double x, y, w, h;
  final String fill;
  final double? radius;
}

/// `{ type:'image', src?, x,y,w,h, fit:'cover'|'contain' }`
class ImageElement extends DrawElement {
  const ImageElement({
    required this.src,
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    required this.fit,
  });

  final String? src;
  final double x, y, w, h;

  /// 'cover' | 'contain'
  final String fit;
}

/// `{ type:'text', text, x,y, size, color, weight, align, strike?, maxWidth? }`
class TextElement extends DrawElement {
  const TextElement({
    required this.text,
    required this.x,
    required this.y,
    required this.size,
    required this.color,
    required this.weight,
    required this.align,
    this.strike,
    this.maxWidth,
  });

  final String text;
  final double x, y, size;
  final String color;

  /// 'bold' | 'normal'
  final String weight;

  /// 'left' | 'center' | 'right'
  final String align;
  final bool? strike;
  final double? maxWidth;
}

/// `{ type:'burst', cx,cy, rOuter,rInner, points, fill }` — the promo seal.
class BurstElement extends DrawElement {
  const BurstElement({
    required this.cx,
    required this.cy,
    required this.rOuter,
    required this.rInner,
    required this.points,
    required this.fill,
  });

  final double cx, cy, rOuter, rInner;
  final int points;
  final String fill;
}

/// Mirror of `compositor::BrandOverride` (partial brand override).
class BrandOverride {
  const BrandOverride({this.primary, this.accent, this.ink, this.bg});

  final String? primary;
  final String? accent;
  final String? ink;
  final String? bg;
}

/// Mirror of `compositor::CompositorOpts`.
class CompositorOpts {
  const CompositorOpts({
    this.size,
    this.template,
    this.brand,
    this.logoUrl,
    this.contact,
    this.shipFree,
    this.bgImage,
    this.cta,
  });

  /// 'square' | 'portrait' | 'story' | 'line' (default 'square').
  final String? size;

  /// banner: 'classic' (default) | 'bold' | 'cny' | 'promo'.
  final String? template;
  final BrandOverride? brand;
  final String? logoUrl;
  final String? contact;

  /// Only an explicit `false` hides the ส่งฟรี pill.
  final bool? shipFree;
  final String? bgImage;
  final String? cta;
}

/// Canvas dimensions per size key (`SIZES`).
class CanvasSize {
  const CanvasSize({required this.width, required this.height});

  final int width;
  final int height;
}

/// `preset()` result — badge text + color for a promo type.
class PresetBadge {
  const PresetBadge({required this.text, required this.color});

  final String text;
  final String color;
}

/// Known size keys, matching `compositor::SIZES`.
const List<String> kCanvasSizeKeys = ['square', 'portrait', 'story', 'line'];
