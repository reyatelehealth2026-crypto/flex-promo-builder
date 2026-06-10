/// Bridge service — the single place the app obtains a [Prom9Api].
///
/// Today this hands out [Prom9ApiStub]; after running
/// `flutter_rust_bridge_codegen generate`, implement `GeneratedProm9Api`
/// (see the header of prom9_api.stub.dart) and change ONE line below.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'prom9_api.stub.dart';

export 'prom9_api.stub.dart' show BridgeUnavailable, Prom9Api;

/// Swap to `GeneratedProm9Api()` once codegen has run.
final Prom9Api prom9Api = Prom9ApiStub();

/// Riverpod handle so widgets/services can be tested with a fake api.
final prom9ApiProvider = Provider<Prom9Api>((ref) => prom9Api);

/// Call once from main() before runApp.
Future<void> initBridge() => prom9Api.init();
