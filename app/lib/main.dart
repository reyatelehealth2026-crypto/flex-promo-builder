import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/theme.dart';
import 'data/bridge/bridge_service.dart';
import 'data/db/app_database.dart';
import 'data/db/product_dao.dart';
import 'data/sample_products.dart';
import 'features/product_hub/product_hub_providers.dart';
import 'features/product_hub/product_hub_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 1) Rust FFI bridge (no-op stub until codegen runs — see README.md).
  await initBridge();

  // 2) SQLite (+FTS5) and first-run seed so the hub has content.
  final db = await AppDatabase.open();
  final dao = ProductDao(db);
  if (dao.count() == 0) {
    dao.insertBatch(kSampleProducts);
  }

  runApp(
    ProviderScope(
      overrides: [productDaoProvider.overrideWithValue(dao)],
      child: const Prom9App(),
    ),
  );
}

class Prom9App extends StatelessWidget {
  const Prom9App({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Prom9',
      theme: prom9Theme(),
      home: const ProductHubScreen(),
      debugShowCheckedModeBanner: false,
    );
  }
}
