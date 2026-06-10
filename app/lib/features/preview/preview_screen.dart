import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/models.dart';
import '../../data/bridge/bridge_service.dart';
import '../card_renderer/card_renderer_screen.dart';
import '../export/export_screen.dart';
import '../product_hub/product_hub_providers.dart';
import 'flex_renderer.dart';

/// Template choice for the preview/export flow.
final templateProvider = StateProvider<FlexTemplate>((ref) => FlexTemplate.classic);

/// Flex preview: pick a template, see the selected products rendered as
/// LINE bubbles (carousel strip), then continue to export or card rendering.
class PreviewScreen extends ConsumerWidget {
  const PreviewScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final products = ref.watch(selectedProductsProvider);
    final template = ref.watch(templateProvider);
    final api = ref.watch(prom9ApiProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Flex Preview'),
        actions: [
          IconButton(
            tooltip: 'Render การ์ดรูป (CustomPainter)',
            icon: const Icon(Icons.image),
            onPressed: products.isEmpty
                ? null
                : () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => CardRendererScreen(products: products),
                      ),
                    ),
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
            child: Wrap(
              spacing: 8,
              children: [
                for (final t in FlexTemplate.values)
                  ChoiceChip(
                    label: Text(t.label),
                    selected: template == t,
                    onSelected: (_) =>
                        ref.read(templateProvider.notifier).state = t,
                  ),
              ],
            ),
          ),
          Expanded(child: _PreviewStrip(products: products, template: template, api: api)),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: FilledButton.icon(
            icon: const Icon(Icons.ios_share),
            label: Text('Export JSON (${products.length} สินค้า)'),
            onPressed: products.isEmpty
                ? null
                : () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => ExportScreen(
                          products: products,
                          template: ref.read(templateProvider),
                        ),
                      ),
                    ),
          ),
        ),
      ),
    );
  }
}

class _PreviewStrip extends StatelessWidget {
  const _PreviewStrip({
    required this.products,
    required this.template,
    required this.api,
  });

  final List<Product> products;
  final FlexTemplate template;
  final Prom9Api api;

  @override
  Widget build(BuildContext context) {
    if (products.isEmpty) {
      return const Center(child: Text('ยังไม่ได้เลือกสินค้า'));
    }
    final List<Map<String, dynamic>> bubbles;
    try {
      bubbles = [
        for (final p in products)
          jsonDecode(api.buildBubbleJson(product: p, template: template))
              as Map<String, dynamic>,
      ];
    } on BridgeUnavailable catch (e) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            'Rust bridge ยังไม่ถูก generate\n\n$e',
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    return Container(
      color: const Color(0xFF8C9BAB), // LINE chat background grey-blue
      child: FlexCarouselView(
        carousel: <String, dynamic>{'type': 'carousel', 'contents': bubbles},
      ),
    );
  }
}
