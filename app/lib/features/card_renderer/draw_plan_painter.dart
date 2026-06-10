/// CustomPainter that executes a compositor [DrawPlan] (the pure draw data
/// produced by prom9_core::creative::compositor). This replaces the Electron
/// offscreen-Chromium card renderer.
///
/// Conventions (matching the plan builders):
///   * All plan coordinates are absolute pixels in [0,width]x[0,height]; the
///     painter scales uniformly to whatever Size it is given, so the same
///     plan paints thumbnails and full 1080px exports.
///   * Text (x, y) anchors: x is the left/center/right edge per `align`; y is
///     the vertical CENTER of the first line (canvas textBaseline:'middle'
///     semantics — the compositor centers badge/seal/price text on box
///     midlines, and advances its cursor by full line heights for blocks).
///   * Images are pre-resolved to ui.Image and passed via [images] keyed by
///     src URL; unresolved/failed sources paint a neutral placeholder.
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../core/models/draw_plan.dart';
import '../../core/theme.dart';

class DrawPlanPainter extends CustomPainter {
  DrawPlanPainter({required this.plan, this.images = const {}});

  final DrawPlan plan;

  /// Resolved bitmaps keyed by `ImageElement.src`.
  final Map<String, ui.Image> images;

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / plan.width;
    canvas.save();
    canvas.scale(scale);

    // Background.
    canvas.drawRect(
      Rect.fromLTWH(0, 0, plan.width.toDouble(), plan.height.toDouble()),
      Paint()..color = _color(plan.background),
    );

    for (final el in plan.elements) {
      switch (el) {
        case RectElement():
          _paintRect(canvas, el);
        case ImageElement():
          _paintImage(canvas, el);
        case TextElement():
          _paintText(canvas, el);
        case BurstElement():
          _paintBurst(canvas, el);
      }
    }
    canvas.restore();
  }

  // ---- rect -----------------------------------------------------------------

  void _paintRect(Canvas canvas, RectElement el) {
    final rect = Rect.fromLTWH(el.x, el.y, el.w, el.h);
    final paint = Paint()..color = _color(el.fill);
    final radius = el.radius ?? 0;
    if (radius > 0) {
      // radius 999 = fully-rounded pill; clamp like CSS border-radius.
      final r = math.min(radius, math.min(el.w, el.h) / 2);
      canvas.drawRRect(RRect.fromRectAndRadius(rect, Radius.circular(r)), paint);
    } else {
      canvas.drawRect(rect, paint);
    }
  }

  // ---- image ----------------------------------------------------------------

  void _paintImage(Canvas canvas, ImageElement el) {
    final dst = Rect.fromLTWH(el.x, el.y, el.w, el.h);
    if (dst.isEmpty) return;
    final image = el.src == null ? null : images[el.src];
    if (image == null) {
      _paintImagePlaceholder(canvas, dst);
      return;
    }

    final srcSize = Size(image.width.toDouble(), image.height.toDouble());
    final fit = el.fit == 'cover' ? BoxFit.cover : BoxFit.contain;
    final fitted = applyBoxFit(fit, srcSize, dst.size);
    final src = Alignment.center.inscribe(fitted.source, Offset.zero & srcSize);
    final out = Alignment.center.inscribe(fitted.destination, dst);

    canvas.save();
    if (el.fit == 'cover') canvas.clipRect(dst);
    canvas.drawImageRect(
      image,
      src,
      out,
      Paint()..filterQuality = FilterQuality.medium,
    );
    canvas.restore();
  }

  void _paintImagePlaceholder(Canvas canvas, Rect dst) {
    canvas.drawRect(dst, Paint()..color = const Color(0xFFEDEDED));
    final cross = Paint()
      ..color = const Color(0xFFC9C9C9)
      ..strokeWidth = math.max(2, dst.shortestSide * 0.02);
    canvas.drawLine(dst.topLeft, dst.bottomRight, cross);
    canvas.drawLine(dst.topRight, dst.bottomLeft, cross);
  }

  // ---- text -----------------------------------------------------------------

  void _paintText(Canvas canvas, TextElement el) {
    final painter = TextPainter(
      text: TextSpan(
        text: el.text,
        style: TextStyle(
          fontSize: el.size,
          color: _color(el.color),
          fontWeight: el.weight == 'bold' ? FontWeight.bold : FontWeight.normal,
          decoration: el.strike == true
              ? TextDecoration.lineThrough
              : TextDecoration.none,
          decorationThickness: 2,
          height: 1.15,
        ),
      ),
      textDirection: TextDirection.ltr,
      textAlign: switch (el.align) {
        'center' => TextAlign.center,
        'right' => TextAlign.right,
        _ => TextAlign.left,
      },
      maxLines: 6,
      ellipsis: '…',
    );
    final maxWidth = el.maxWidth ?? plan.width.toDouble();
    painter.layout(maxWidth: maxWidth);

    final lineHeight = painter.height /
        math.max(1, painter.computeLineMetrics().length);
    final dx = switch (el.align) {
      'center' => el.x - painter.width / 2,
      'right' => el.x - painter.width,
      _ => el.x,
    };
    // y = vertical center of the FIRST line (see header).
    final dy = el.y - lineHeight / 2;
    painter.paint(canvas, Offset(dx, dy));
    painter.dispose();
  }

  // ---- burst (star polygon seal) ----------------------------------------------

  void _paintBurst(Canvas canvas, BurstElement el) {
    final path = Path();
    final spikes = el.points;
    for (var i = 0; i < spikes * 2; i++) {
      final r = i.isEven ? el.rOuter : el.rInner;
      final angle = -math.pi / 2 + i * math.pi / spikes;
      final x = el.cx + r * math.cos(angle);
      final y = el.cy + r * math.sin(angle);
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    path.close();
    canvas.drawPath(path, Paint()..color = _color(el.fill));
  }

  // ---- color ----------------------------------------------------------------

  /// Plans carry hex colors plus one 'rgba(0,0,0,0.55)' scrim (overlay plan).
  Color _color(String value) {
    final v = value.trim();
    if (v.startsWith('rgba(') && v.endsWith(')')) {
      final parts = v.substring(5, v.length - 1).split(',');
      if (parts.length == 4) {
        return Color.fromRGBO(
          int.tryParse(parts[0].trim()) ?? 0,
          int.tryParse(parts[1].trim()) ?? 0,
          int.tryParse(parts[2].trim()) ?? 0,
          double.tryParse(parts[3].trim()) ?? 1,
        );
      }
    }
    return parseHexColor(v, fallback: Colors.black);
  }

  @override
  bool shouldRepaint(DrawPlanPainter oldDelegate) =>
      oldDelegate.plan != plan || oldDelegate.images != images;
}
