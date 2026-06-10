import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'product_hub_providers.dart';
import 'widgets/debounced_search_box.dart';
import 'widgets/product_tile.dart';
import 'widgets/promo_filter_chips.dart';
import 'widgets/selection_bar.dart';

/// Product Hub: searchable, filterable catalog list with multi-select.
class ProductHubScreen extends ConsumerWidget {
  const ProductHubScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final products = ref.watch(productListProvider);
    final selection = ref.watch(selectionProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Prom9 — Product Hub'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(104),
          child: Column(
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(12, 0, 12, 8),
                child: DebouncedSearchBox(),
              ),
              const PromoFilterChips(),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
      body: products.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text('โหลดสินค้าไม่สำเร็จ: $e', textAlign: TextAlign.center),
          ),
        ),
        data: (items) {
          if (items.isEmpty) {
            return const Center(child: Text('ไม่พบสินค้า — ลองเปลี่ยนคำค้น/ฟิลเตอร์'));
          }
          final selected = selection.toSet();
          return ListView.builder(
            itemCount: items.length,
            itemBuilder: (context, index) {
              final product = items[index];
              return ProductTile(
                product: product,
                selected: selected.contains(product.code),
                onTap: () =>
                    ref.read(selectionProvider.notifier).toggle(product.code),
              );
            },
          );
        },
      ),
      bottomNavigationBar: const SelectionBar(),
    );
  }
}
