import 'package:flutter/material.dart';

/// Prom9 brand colors (match the compositor's default brand).
abstract final class Prom9Colors {
  static const Color primary = Color(0xFFE8000D); // SALE_RED
  static const Color accent = Color(0xFF27AE60);
  static const Color ink = Color(0xFF222222);
  static const Color gold = Color(0xFFFFC400);
  static const Color warn = Color(0xFFF59E0B);
}

ThemeData prom9Theme() {
  final scheme = ColorScheme.fromSeed(seedColor: Prom9Colors.primary);
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      foregroundColor: Prom9Colors.ink,
      elevation: 0,
      centerTitle: false,
    ),
    chipTheme: const ChipThemeData(showCheckmark: false),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );
}

/// Parse '#RRGGBB' / '#RGB' / '#RRGGBBAA' into a [Color]; bad input falls
/// back to [fallback]. Shared by the flex renderer and the card painter.
Color parseHexColor(String? hex, {Color fallback = Colors.black}) {
  if (hex == null) return fallback;
  var h = hex.trim();
  if (!h.startsWith('#')) return fallback;
  h = h.substring(1);
  if (h.length == 3) {
    h = h.split('').map((c) => '$c$c').join();
  }
  if (h.length == 6) h = 'FF$h'; // opaque
  if (h.length == 8 && hex.length == 9) {
    // '#RRGGBBAA' -> 'AARRGGBB'
    h = h.substring(6) + h.substring(0, 6);
  }
  final value = int.tryParse(h, radix: 16);
  return value == null ? fallback : Color(value);
}
