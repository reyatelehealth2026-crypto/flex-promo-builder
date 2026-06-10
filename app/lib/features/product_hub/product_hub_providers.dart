/// Riverpod state for the Product Hub: search text (already debounced by the
/// search box widget), promo-type filter, the derived product list, and the
/// multi-select set.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/models.dart';
import '../../data/db/product_dao.dart';

/// Overridden in main() with the opened DAO.
final productDaoProvider = Provider<ProductDao>(
  (ref) => throw UnimplementedError('productDaoProvider must be overridden'),
);

/// Debounced search text (the DebouncedSearchBox writes here at most every
/// ~250ms).
final searchQueryProvider = StateProvider<String>((ref) => '');

/// Selected promo-type chip; null = all.
final promoFilterProvider = StateProvider<String?>((ref) => null);

/// Bumped after imports/clears to refresh the list.
final catalogVersionProvider = StateProvider<int>((ref) => 0);

/// The visible product list = FTS5 search x promo filter.
final productListProvider = FutureProvider.autoDispose<List<Product>>((ref) async {
  ref.watch(catalogVersionProvider);
  final query = ref.watch(searchQueryProvider);
  final promoType = ref.watch(promoFilterProvider);
  final dao = ref.watch(productDaoProvider);
  // package:sqlite3 is synchronous; keep the await point so the UI shows the
  // AsyncValue loading state on first build.
  return Future(() => dao.search(query: query, promoType: promoType));
});

/// Multi-select: the set of selected product codes (order preserved).
class SelectionNotifier extends Notifier<List<String>> {
  @override
  List<String> build() => const [];

  void toggle(String code) {
    state = state.contains(code)
        ? state.where((c) => c != code).toList()
        : [...state, code];
  }

  void clear() => state = const [];
}

final selectionProvider =
    NotifierProvider<SelectionNotifier, List<String>>(SelectionNotifier.new);

/// The selected products, resolved from the DB in selection order.
final selectedProductsProvider = Provider.autoDispose<List<Product>>((ref) {
  final codes = ref.watch(selectionProvider);
  if (codes.isEmpty) return const [];
  return ref.watch(productDaoProvider).byCodes(codes);
});
