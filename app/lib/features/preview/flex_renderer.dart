/// Flex preview renderer: turns LINE Flex bubble JSON (the exact subset the
/// five prom9 templates emit — see prom9_core/src/flex/builder.rs) into
/// Flutter widgets.
///
/// Supported nodes / properties (enumerated from the template builders):
///   bubble    : hero (image), body (box), footer (box)
///   box       : layout vertical|horizontal|baseline, contents,
///               backgroundColor, cornerRadius, paddingAll/paddingStart/
///               paddingEnd, spacing, margin, flex, borderColor, borderWidth,
///               alignItems ('center')
///   text      : text, size (xxs..xxl), weight ('bold'), color, wrap, align
///               ('start'|'center'|'end'), decoration ('line-through'),
///               margin, flex, gravity ('center')
///   image     : url, size 'full', aspectRatio '1:1', aspectMode
///               'cover'|'fit', margin, backgroundColor
///   button    : style 'primary', color, height 'sm', action.message
///               {label, text}
///   separator : margin, color
///   filler    : (takes free space in a horizontal box)
library;

import 'package:flutter/material.dart';

import '../../core/theme.dart';

// LINE keyword sizes in logical px (Flex text size tokens).
const Map<String, double> _textSizes = {
  'xxs': 11, 'xs': 13, 'sm': 14, 'md': 16, 'lg': 19, 'xl': 22, 'xxl': 29,
  '3xl': 33, '4xl': 37, '5xl': 41,
};

// LINE spacing/margin tokens in logical px.
const Map<String, double> _spacing = {
  'none': 0, 'xs': 2, 'sm': 4, 'md': 8, 'lg': 12, 'xl': 16, 'xxl': 20,
};

double _length(Object? v, {double fallback = 0}) {
  if (v == null) return fallback;
  if (v is num) return v.toDouble();
  final s = v.toString().trim();
  if (_spacing.containsKey(s)) return _spacing[s]!;
  final px = s.endsWith('px') ? s.substring(0, s.length - 2) : s;
  return double.tryParse(px) ?? fallback;
}

enum _Axis { vertical, horizontal }

/// Renders one bubble at LINE's mega-bubble-ish width.
class FlexBubbleView extends StatelessWidget {
  const FlexBubbleView({super.key, required this.bubble, this.width = 280});

  final Map<String, dynamic> bubble;
  final double width;

  @override
  Widget build(BuildContext context) {
    final hero = bubble['hero'] as Map<String, dynamic>?;
    final body = bubble['body'] as Map<String, dynamic>?;
    final footer = bubble['footer'] as Map<String, dynamic>?;

    return Container(
      width: width,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: const [
          BoxShadow(color: Color(0x1F000000), blurRadius: 8, offset: Offset(0, 2)),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (hero != null) _FlexNode(node: hero, parentAxis: _Axis.vertical),
          if (body != null) _FlexNode(node: body, parentAxis: _Axis.vertical),
          if (footer != null) _FlexNode(node: footer, parentAxis: _Axis.vertical),
        ],
      ),
    );
  }
}

/// Renders a whole carousel as a horizontally scrolling bubble strip.
class FlexCarouselView extends StatelessWidget {
  const FlexCarouselView({super.key, required this.carousel, this.bubbleWidth = 280});

  final Map<String, dynamic> carousel;
  final double bubbleWidth;

  @override
  Widget build(BuildContext context) {
    final contents =
        (carousel['contents'] as List<dynamic>? ?? const <dynamic>[])
            .cast<Map<String, dynamic>>();
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.all(16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final bubble in contents) ...[
            FlexBubbleView(bubble: bubble, width: bubbleWidth),
            const SizedBox(width: 12),
          ],
        ],
      ),
    );
  }
}

class _FlexNode extends StatelessWidget {
  const _FlexNode({required this.node, required this.parentAxis});

  final Map<String, dynamic> node;
  final _Axis parentAxis;

  @override
  Widget build(BuildContext context) {
    return switch (node['type'] as String? ?? '') {
      'box' => _buildBox(context),
      'text' => _buildText(context),
      'image' => _buildImage(context),
      'button' => _buildButton(context),
      'separator' => _buildSeparator(context),
      'filler' => const SizedBox.shrink(), // expansion handled by the parent
      _ => const SizedBox.shrink(),
    };
  }

  // ---- box -----------------------------------------------------------------

  Widget _buildBox(BuildContext context) {
    final layout = node['layout'] as String? ?? 'vertical';
    final axis = layout == 'vertical' ? _Axis.vertical : _Axis.horizontal;
    final contents = (node['contents'] as List<dynamic>? ?? const <dynamic>[])
        .cast<Map<String, dynamic>>();
    final spacing = _length(node['spacing']);

    final children = <Widget>[];
    for (var i = 0; i < contents.length; i++) {
      final child = contents[i];
      // Gap before a child: its own margin wins over the parent's spacing;
      // no gap before the first child (LINE semantics).
      if (i > 0) {
        final gap =
            child.containsKey('margin') ? _length(child['margin']) : spacing;
        if (gap > 0) {
          children.add(axis == _Axis.vertical
              ? SizedBox(height: gap)
              : SizedBox(width: gap));
        }
      }
      children.add(_wrapFlex(axis, child, _FlexNode(node: child, parentAxis: axis)));
    }

    Widget inner;
    if (axis == _Axis.vertical) {
      inner = Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: children,
      );
    } else {
      // 'baseline' renders as a centered row here — the templates only use it
      // with same-size text so the difference is invisible at preview scale.
      inner = Row(crossAxisAlignment: CrossAxisAlignment.center, children: children);
    }

    final bg = node['backgroundColor'] as String?;
    final radius = _length(node['cornerRadius']);
    final borderColor = node['borderColor'] as String?;
    final borderWidth = _length(node['borderWidth']);

    final paddingAll = _length(node['paddingAll']);
    final padding = EdgeInsets.only(
      top: _length(node['paddingTop'], fallback: paddingAll),
      bottom: _length(node['paddingBottom'], fallback: paddingAll),
      left: _length(node['paddingStart'], fallback: paddingAll),
      right: _length(node['paddingEnd'], fallback: paddingAll),
    );

    return Container(
      padding: padding,
      clipBehavior: bg != null || radius > 0 ? Clip.antiAlias : Clip.none,
      decoration: BoxDecoration(
        color: bg == null ? null : parseHexColor(bg),
        borderRadius: radius > 0 ? BorderRadius.circular(radius) : null,
        border: borderColor != null && borderWidth > 0
            ? Border.all(color: parseHexColor(borderColor), width: borderWidth)
            : null,
      ),
      child: inner,
    );
  }

  /// Horizontal-box flex semantics: filler and flex-less children expand
  /// (LINE default flex is 1), `flex: 0` hugs content, `flex: n` shares space.
  Widget _wrapFlex(_Axis axis, Map<String, dynamic> child, Widget built) {
    if (axis != _Axis.horizontal) return built;
    if (child['type'] == 'filler') return const Expanded(child: SizedBox.shrink());
    final flex = child['flex'];
    if (flex is int) {
      return flex <= 0 ? built : Expanded(flex: flex, child: built);
    }
    return Expanded(child: built);
  }

  // ---- text ------------------------------------------------------------------

  Widget _buildText(BuildContext context) {
    final wrap = node['wrap'] == true;
    final align = switch (node['align'] as String?) {
      'center' => TextAlign.center,
      'end' => TextAlign.end,
      _ => TextAlign.start,
    };
    final text = Text(
      node['text'] as String? ?? '',
      textAlign: align,
      maxLines: wrap ? null : 1,
      overflow: wrap ? null : TextOverflow.ellipsis,
      style: TextStyle(
        fontSize: _textSizes[node['size'] as String? ?? 'md'] ?? 16,
        fontWeight:
            node['weight'] == 'bold' ? FontWeight.bold : FontWeight.normal,
        color: parseHexColor(node['color'] as String?, fallback: const Color(0xFF111111)),
        decoration: node['decoration'] == 'line-through'
            ? TextDecoration.lineThrough
            : TextDecoration.none,
        height: 1.3,
      ),
    );
    // gravity 'center' only matters inside horizontal rows, which already
    // center their children vertically (see _buildBox).
    return text;
  }

  // ---- image ----------------------------------------------------------------

  Widget _buildImage(BuildContext context) {
    final url = node['url'] as String? ?? '';
    final aspect = _parseAspect(node['aspectRatio'] as String? ?? '1:1');
    final cover = (node['aspectMode'] as String? ?? 'fit') == 'cover';
    final bg = node['backgroundColor'] as String?;

    return AspectRatio(
      aspectRatio: aspect,
      child: Container(
        color: bg != null ? parseHexColor(bg) : null,
        child: url.isEmpty
            ? const ColoredBox(
                color: Color(0xFFEEEEEE),
                child: Icon(Icons.image_outlined, color: Color(0xFFBBBBBB)),
              )
            : Image.network(
                url,
                fit: cover ? BoxFit.cover : BoxFit.contain,
                errorBuilder: (_, __, ___) => const ColoredBox(
                  color: Color(0xFFEEEEEE),
                  child: Icon(Icons.broken_image_outlined, color: Color(0xFFBBBBBB)),
                ),
                loadingBuilder: (context, child, progress) => progress == null
                    ? child
                    : const ColoredBox(color: Color(0xFFF6F6F6)),
              ),
      ),
    );
  }

  double _parseAspect(String ratio) {
    final parts = ratio.split(':');
    if (parts.length != 2) return 1;
    final w = double.tryParse(parts[0]) ?? 1;
    final h = double.tryParse(parts[1]) ?? 1;
    return h == 0 ? 1 : w / h;
  }

  // ---- button ----------------------------------------------------------------

  Widget _buildButton(BuildContext context) {
    final action = node['action'] as Map<String, dynamic>? ?? const {};
    final label = action['label'] as String? ?? '';
    final messageText = action['text'] as String? ?? label;
    final color = parseHexColor(node['color'] as String?, fallback: Prom9Colors.primary);
    final height = node['height'] == 'sm' ? 40.0 : 48.0;

    return SizedBox(
      height: height,
      child: FilledButton(
        style: FilledButton.styleFrom(
          backgroundColor: color,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
        onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('message action: $messageText')),
        ),
        child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
    );
  }

  // ---- separator ---------------------------------------------------------------

  Widget _buildSeparator(BuildContext context) {
    return Container(
      height: 1,
      color: parseHexColor(node['color'] as String?, fallback: const Color(0xFFEEEEEE)),
    );
  }
}
