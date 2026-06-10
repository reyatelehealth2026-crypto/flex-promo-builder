import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/models.dart';
import '../product_hub_providers.dart';

/// Single-choice promo-type filter row ("ทั้งหมด" + the 4 promo presets).
class PromoFilterChips extends ConsumerWidget {
  const PromoFilterChips({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(promoFilterProvider);
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        children: [
          ChoiceChip(
            label: const Text('ทั้งหมด'),
            selected: selected == null,
            onSelected: (_) =>
                ref.read(promoFilterProvider.notifier).state = null,
          ),
          for (final type in kPromoTypes) ...[
            const SizedBox(width: 8),
            ChoiceChip(
              label: Text(kPromoTypeLabels[type] ?? type),
              selected: selected == type,
              onSelected: (on) =>
                  ref.read(promoFilterProvider.notifier).state = on ? type : null,
            ),
          ],
        ],
      ),
    );
  }
}
