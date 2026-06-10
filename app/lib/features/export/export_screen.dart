import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/models/models.dart';
import '../../data/bridge/bridge_service.dart';
import 'widgets/validation_panel.dart';

/// Export screen: pretty carousel JSON + copy/share + validation panel.
/// Selections above 12 products arrive as multiple carousels (the bridge
/// `build_carousels_json` auto-splits), each validated independently.
class ExportScreen extends ConsumerWidget {
  const ExportScreen({super.key, required this.products, required this.template});

  final List<Product> products;
  final FlexTemplate template;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.watch(prom9ApiProvider);

    final List<_CarouselExport> exports;
    try {
      exports = [
        for (final carouselJson
            in api.buildCarouselsJson(products: products, template: template))
          _CarouselExport(
            carouselJson: carouselJson,
            messageJson: api.buildFlexMessageJson(carouselJson: carouselJson),
            validation: api.validateCarouselJson(carouselJson: carouselJson),
          ),
      ];
    } on BridgeUnavailable catch (e) {
      return Scaffold(
        appBar: AppBar(title: const Text('Export Flex JSON')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text('$e', textAlign: TextAlign.center),
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(
          exports.length == 1
              ? 'Export Flex JSON'
              : 'Export Flex JSON (${exports.length} carousels)',
        ),
      ),
      body: ListView.separated(
        padding: const EdgeInsets.all(12),
        itemCount: exports.length,
        separatorBuilder: (_, __) => const SizedBox(height: 16),
        itemBuilder: (context, i) => _CarouselSection(
          index: i,
          total: exports.length,
          export: exports[i],
        ),
      ),
    );
  }
}

class _CarouselExport {
  _CarouselExport({
    required this.carouselJson,
    required this.messageJson,
    required this.validation,
  });

  final String carouselJson;

  /// Full `{type:'flex', altText, contents}` envelope (what you paste into
  /// the Messaging API / LINE OA broadcast).
  final String messageJson;
  final FlexValidation validation;

  String get prettyCarousel => const JsonEncoder.withIndent('  ')
      .convert(jsonDecode(carouselJson));
}

class _CarouselSection extends StatelessWidget {
  const _CarouselSection({
    required this.index,
    required this.total,
    required this.export,
  });

  final int index;
  final int total;
  final _CarouselExport export;

  Future<void> _copy(BuildContext context, String label, String data) async {
    final messenger = ScaffoldMessenger.of(context);
    await Clipboard.setData(ClipboardData(text: data));
    messenger.showSnackBar(SnackBar(content: Text('คัดลอก $label แล้ว')));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (total > 1)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text('Carousel ${index + 1} / $total',
                style: theme.textTheme.titleMedium),
          ),
        ValidationPanel(validation: export.validation),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            OutlinedButton.icon(
              icon: const Icon(Icons.copy, size: 18),
              label: const Text('คัดลอก carousel'),
              onPressed: () =>
                  _copy(context, 'carousel JSON', export.carouselJson),
            ),
            OutlinedButton.icon(
              icon: const Icon(Icons.copy_all, size: 18),
              label: const Text('คัดลอก flex message'),
              onPressed: () =>
                  _copy(context, 'flex message JSON', export.messageJson),
            ),
            OutlinedButton.icon(
              icon: const Icon(Icons.share, size: 18),
              label: const Text('แชร์'),
              onPressed: () => Share.share(
                export.messageJson,
                subject: 'Prom9 flex message',
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Card(
          margin: EdgeInsets.zero,
          color: const Color(0xFF1E1E2E),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: SelectableText(
              export.prettyCarousel,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 12,
                color: Color(0xFFE6E6F0),
                height: 1.4,
              ),
            ),
          ),
        ),
      ],
    );
  }
}
