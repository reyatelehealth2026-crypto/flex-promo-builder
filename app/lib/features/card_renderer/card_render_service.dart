/// Batch card rendering: products -> compositor DrawPlans -> PNG bytes.
///
/// This is the Flutter replacement for the Electron offscreen-Chromium
/// renderer (desktop/card-renderer.cjs): plans come from Rust, painting is a
/// dart:ui PictureRecorder, and a whole catalog can be rendered concurrently
/// (network image fetches overlap; rasterization itself stays on the UI
/// isolate because dart:ui objects are not sendable across isolates).
library;

import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../core/models/models.dart';
import '../../data/bridge/bridge_service.dart';
import 'draw_plan_painter.dart';

/// Which plan builder to use for a batch.
enum CardPlanKind { banner, overlay, promoCard }

class CardRenderResult {
  const CardRenderResult({
    required this.product,
    this.pngBytes,
    this.error,
  });

  final Product product;
  final Uint8List? pngBytes;
  final Object? error;

  bool get ok => pngBytes != null;
}

class CardRenderService {
  CardRenderService(this._api);

  final Prom9Api _api;

  /// Build the draw plan for one product.
  DrawPlan planFor(
    Product product, {
    CardPlanKind kind = CardPlanKind.promoCard,
    CompositorOpts opts = const CompositorOpts(),
  }) =>
      switch (kind) {
        CardPlanKind.banner => _api.bannerPlan(product: product, opts: opts),
        CardPlanKind.overlay => _api.overlayPlan(product: product, opts: opts),
        CardPlanKind.promoCard =>
          _api.promoCardPlan(product: product, opts: opts),
      };

  /// Render one plan to PNG bytes at its native plan size.
  Future<Uint8List> renderPlanToPng(DrawPlan plan) async {
    final images = await resolveImages(plan);
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    DrawPlanPainter(plan: plan, images: images).paint(
      canvas,
      Size(plan.width.toDouble(), plan.height.toDouble()),
    );
    final picture = recorder.endRecording();
    try {
      final image = await picture.toImage(plan.width, plan.height);
      try {
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        if (bytes == null) {
          throw StateError('PNG encode returned null');
        }
        return bytes.buffer.asUint8List();
      } finally {
        image.dispose();
      }
    } finally {
      picture.dispose();
    }
  }

  /// Batch-render N products with bounded concurrency. Per-product failures
  /// (dead image URLs etc.) are captured in the result rather than aborting
  /// the batch.
  Future<List<CardRenderResult>> renderBatch(
    List<Product> products, {
    CardPlanKind kind = CardPlanKind.promoCard,
    CompositorOpts opts = const CompositorOpts(),
    int concurrency = 4,
    void Function(int done, int total)? onProgress,
  }) async {
    final results = List<CardRenderResult?>.filled(products.length, null);
    var next = 0;
    var done = 0;

    Future<void> worker() async {
      while (true) {
        final i = next;
        if (i >= products.length) return;
        next += 1;
        final product = products[i];
        try {
          final png = await renderPlanToPng(
            planFor(product, kind: kind, opts: opts),
          );
          results[i] = CardRenderResult(product: product, pngBytes: png);
        } catch (e) {
          results[i] = CardRenderResult(product: product, error: e);
        }
        done += 1;
        onProgress?.call(done, products.length);
      }
    }

    await Future.wait([
      for (var w = 0; w < concurrency; w++) worker(),
    ]);
    return results.cast<CardRenderResult>();
  }

  /// Resolve every image src in the plan to a ui.Image (concurrently).
  /// Failures resolve to null -> the painter draws its placeholder. Also used
  /// by the on-screen previews, so the PNG export shares the ImageCache.
  Future<Map<String, ui.Image>> resolveImages(DrawPlan plan) async {
    final srcs = <String>{
      for (final el in plan.elements)
        if (el is ImageElement && el.src != null && el.src!.isNotEmpty) el.src!,
    };
    final resolved = await Future.wait([
      for (final src in srcs)
        _loadImage(src).then<(String, ui.Image?)>(
          (img) => (src, img),
          onError: (Object _) => (src, null),
        ),
    ]);
    return {
      for (final (src, img) in resolved)
        if (img != null) src: img,
    };
  }

  Future<ui.Image?> _loadImage(
    String src, {
    Duration timeout = const Duration(seconds: 12),
  }) {
    final completer = Completer<ui.Image?>();
    final provider = NetworkImage(src);
    final stream = provider.resolve(ImageConfiguration.empty);
    late final ImageStreamListener listener;
    listener = ImageStreamListener(
      (info, _) {
        if (!completer.isCompleted) completer.complete(info.image);
        stream.removeListener(listener);
      },
      onError: (error, _) {
        if (!completer.isCompleted) completer.complete(null);
        stream.removeListener(listener);
      },
    );
    stream.addListener(listener);
    return completer.future.timeout(
      timeout,
      onTimeout: () {
        stream.removeListener(listener);
        return null;
      },
    );
  }
}
