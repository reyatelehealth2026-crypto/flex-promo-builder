import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../../core/models/models.dart';
import '../../data/bridge/bridge_service.dart';
import 'card_render_service.dart';
import 'draw_plan_painter.dart';

final cardRenderServiceProvider = Provider<CardRenderService>(
  (ref) => CardRenderService(ref.watch(prom9ApiProvider)),
);

/// Card renderer: live CustomPainter previews of the compositor draw plans
/// for the selected products, plus a batch "export PNGs" action (the
/// offscreen-Chromium replacement).
class CardRendererScreen extends ConsumerStatefulWidget {
  const CardRendererScreen({super.key, required this.products});

  final List<Product> products;

  @override
  ConsumerState<CardRendererScreen> createState() => _CardRendererScreenState();
}

class _CardRendererScreenState extends ConsumerState<CardRendererScreen> {
  CardPlanKind _kind = CardPlanKind.promoCard;
  String _sizeKey = 'square';
  bool _rendering = false;
  double _progress = 0;

  CompositorOpts get _opts => CompositorOpts(size: _sizeKey);

  Future<void> _exportBatch() async {
    final messenger = ScaffoldMessenger.of(context);
    final service = ref.read(cardRenderServiceProvider);
    setState(() {
      _rendering = true;
      _progress = 0;
    });
    try {
      final results = await service.renderBatch(
        widget.products,
        kind: _kind,
        opts: _opts,
        onProgress: (done, total) {
          if (mounted) setState(() => _progress = done / total);
        },
      );
      final dir = Directory(
        p.join((await getApplicationDocumentsDirectory()).path, 'prom9_cards'),
      );
      await dir.create(recursive: true);
      var okCount = 0;
      for (final r in results) {
        if (r.pngBytes == null) continue;
        await File(p.join(dir.path, '${r.product.code}_$_sizeKey.png'))
            .writeAsBytes(r.pngBytes!);
        okCount += 1;
      }
      messenger.showSnackBar(SnackBar(
        content: Text(
          'บันทึก $okCount/${results.length} การ์ดที่ ${dir.path}'
          '${okCount < results.length ? ' (ที่เหลือ render ไม่สำเร็จ)' : ''}',
        ),
      ));
    } on BridgeUnavailable catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _rendering = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final service = ref.watch(cardRenderServiceProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Card Renderer (CustomPainter)')),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
            child: Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                for (final kind in CardPlanKind.values)
                  ChoiceChip(
                    label: Text(switch (kind) {
                      CardPlanKind.banner => 'Banner',
                      CardPlanKind.overlay => 'Overlay',
                      CardPlanKind.promoCard => 'Promo Card',
                    }),
                    selected: _kind == kind,
                    onSelected: (_) => setState(() => _kind = kind),
                  ),
                const SizedBox(width: 12),
                for (final key in kCanvasSizeKeys)
                  ChoiceChip(
                    label: Text(key),
                    selected: _sizeKey == key,
                    onSelected: (_) => setState(() => _sizeKey = key),
                  ),
              ],
            ),
          ),
          Expanded(child: _buildGrid(service)),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: FilledButton.icon(
            icon: _rendering
                ? SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      value: _progress == 0 ? null : _progress,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.collections),
            label: Text(_rendering
                ? 'กำลัง render... ${(_progress * 100).round()}%'
                : 'Export PNG ทั้งชุด (${widget.products.length})'),
            onPressed: _rendering ? null : _exportBatch,
          ),
        ),
      ),
    );
  }

  Widget _buildGrid(CardRenderService service) {
    final List<(Product, DrawPlan)> plans;
    try {
      plans = [
        for (final product in widget.products)
          (product, service.planFor(product, kind: _kind, opts: _opts)),
      ];
    } on BridgeUnavailable catch (e) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text('$e', textAlign: TextAlign.center),
        ),
      );
    }

    return GridView.builder(
      padding: const EdgeInsets.all(12),
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 260,
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
        childAspectRatio: 0.8,
      ),
      itemCount: plans.length,
      itemBuilder: (context, i) {
        final (product, plan) = plans[i];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: _LiveCardPreview(plan: plan),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              '${product.code} • ${plan.width}x${plan.height}',
              style: Theme.of(context).textTheme.labelSmall,
            ),
          ],
        );
      },
    );
  }
}

/// On-screen preview: resolves the plan's images through the render
/// service's loader (sharing NetworkImage's ImageCache with the PNG export),
/// then paints with [DrawPlanPainter]. Placeholders show while images load.
class _LiveCardPreview extends ConsumerStatefulWidget {
  const _LiveCardPreview({required this.plan});

  final DrawPlan plan;

  @override
  ConsumerState<_LiveCardPreview> createState() => _LiveCardPreviewState();
}

class _LiveCardPreviewState extends ConsumerState<_LiveCardPreview> {
  late Future<Map<String, ui.Image>> _images;

  @override
  void initState() {
    super.initState();
    _images = ref.read(cardRenderServiceProvider).resolveImages(widget.plan);
  }

  @override
  void didUpdateWidget(_LiveCardPreview old) {
    super.didUpdateWidget(old);
    if (old.plan != widget.plan) {
      _images = ref.read(cardRenderServiceProvider).resolveImages(widget.plan);
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Map<String, ui.Image>>(
      future: _images,
      builder: (context, snapshot) => AspectRatio(
        aspectRatio: widget.plan.width / widget.plan.height,
        child: CustomPaint(
          painter: DrawPlanPainter(
            plan: widget.plan,
            images: snapshot.data ?? const {},
          ),
        ),
      ),
    );
  }
}
