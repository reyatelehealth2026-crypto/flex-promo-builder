import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/models.dart';
import '../../../core/theme.dart';
import '../../preview/preview_screen.dart';
import '../product_hub_providers.dart';

/// Bottom bar shown while a selection exists: count + clear + "Build Flex".
class SelectionBar extends ConsumerWidget {
  const SelectionBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selection = ref.watch(selectionProvider);
    if (selection.isEmpty) return const SizedBox.shrink();

    final over = selection.length > FlexValidation.maxBubbles;
    return Material(
      elevation: 8,
      color: Theme.of(context).colorScheme.surface,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'เลือกแล้ว ${selection.length} รายการ',
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    if (over)
                      Text(
                        'เกิน ${FlexValidation.maxBubbles} ชิ้น — จะแบ่งเป็นหลาย carousel อัตโนมัติ',
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: Prom9Colors.warn),
                      ),
                  ],
                ),
              ),
              TextButton.icon(
                onPressed: () => ref.read(selectionProvider.notifier).clear(),
                icon: const Icon(Icons.close),
                label: const Text('ล้าง'),
              ),
              const SizedBox(width: 8),
              FilledButton.icon(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const PreviewScreen(),
                  ),
                ),
                icon: const Icon(Icons.auto_awesome_mosaic),
                label: const Text('สร้าง Flex'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
