/// Mirror of `prom9_core::flex::validate::Validation` / `FfiValidation`.
class FlexValidation {
  const FlexValidation({
    required this.ok,
    required this.errors,
    required this.warnings,
    required this.bytes,
  });

  final bool ok;
  final List<String> errors;
  final List<String> warnings;

  /// UTF-8 byte length of the compact carousel JSON.
  final int bytes;

  /// `MAX_BYTES` — hard LINE payload limit (~50KB).
  static const int maxBytes = 50 * 1024;

  /// `WARN_BYTES` — warn threshold before the hard limit.
  static const int warnBytes = 45 * 1024;

  /// `MAX_BUBBLES` — carousel bubble cap.
  static const int maxBubbles = 12;

  bool get nearLimit => bytes > warnBytes && bytes <= maxBytes;
  bool get overLimit => bytes > maxBytes;

  /// `fmtBytes`: "512 B" below 1KB, "X.Y KB" otherwise (toFixed(1) ties up).
  static String fmtBytes(int n) {
    if (n < 1024) return '$n B';
    final tenths = (n / 1024 * 10).round();
    return '${tenths ~/ 10}.${tenths % 10} KB';
  }
}
