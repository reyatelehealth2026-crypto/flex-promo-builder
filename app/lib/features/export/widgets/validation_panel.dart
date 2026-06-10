import 'package:flutter/material.dart';

import '../../../core/models/models.dart';
import '../../../core/theme.dart';

/// Shows a [FlexValidation]: ok/errors/warnings lists plus a byte gauge
/// against the 50KB LINE limit (amber styling past the 45KB warn threshold,
/// red past the limit).
class ValidationPanel extends StatelessWidget {
  const ValidationPanel({super.key, required this.validation});

  final FlexValidation validation;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final v = validation;

    final Color gaugeColor = v.overLimit
        ? theme.colorScheme.error
        : v.nearLimit
            ? Prom9Colors.warn
            : Prom9Colors.accent;
    final progress =
        (v.bytes / FlexValidation.maxBytes).clamp(0.0, 1.0).toDouble();

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  v.ok ? Icons.check_circle : Icons.error,
                  color: v.ok ? Prom9Colors.accent : theme.colorScheme.error,
                ),
                const SizedBox(width: 8),
                Text(
                  v.ok ? 'ผ่านการตรวจสอบ' : 'พบปัญหา ${v.errors.length} รายการ',
                  style: theme.textTheme.titleSmall,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: progress,
                      minHeight: 8,
                      color: gaugeColor,
                      backgroundColor:
                          theme.colorScheme.surfaceContainerHighest,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  '${FlexValidation.fmtBytes(v.bytes)} / '
                  '${FlexValidation.fmtBytes(FlexValidation.maxBytes)}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: gaugeColor,
                    fontWeight:
                        v.nearLimit || v.overLimit ? FontWeight.bold : null,
                  ),
                ),
              ],
            ),
            if (v.nearLimit)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  'ใกล้ขีดจำกัด (เตือนที่ ${FlexValidation.fmtBytes(FlexValidation.warnBytes)})',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: Prom9Colors.warn),
                ),
              ),
            for (final e in v.errors)
              _IssueRow(icon: Icons.cancel, color: theme.colorScheme.error, text: e),
            for (final w in v.warnings)
              _IssueRow(icon: Icons.warning_amber, color: Prom9Colors.warn, text: w),
          ],
        ),
      ),
    );
  }
}

class _IssueRow extends StatelessWidget {
  const _IssueRow({required this.icon, required this.color, required this.text});

  final IconData icon;
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 6),
          Expanded(
            child: Text(text, style: Theme.of(context).textTheme.bodySmall),
          ),
        ],
      ),
    );
  }
}
