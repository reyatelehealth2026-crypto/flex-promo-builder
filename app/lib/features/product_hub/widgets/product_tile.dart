import 'package:flutter/material.dart';

import '../../../core/models/models.dart';
import '../../../core/theme.dart';

/// One row in the product list: thumbnail, name, code, prices, promo badge,
/// with a checkbox-style selection state.
class ProductTile extends StatelessWidget {
  const ProductTile({
    super.key,
    required this.product,
    required this.selected,
    required this.onTap,
  });

  final Product product;
  final bool selected;
  final VoidCallback onTap;

  String _money(double n) {
    // Display-only formatting; the canonical money() lives in Rust.
    final s = n.toStringAsFixed(2);
    final trimmed = s.endsWith('.00') ? s.substring(0, s.length - 3) : s;
    final parts = trimmed.split('.');
    final intPart = parts.first.replaceAllMapped(
      RegExp(r'\B(?=(\d{3})+(?!\d))'),
      (m) => ',',
    );
    return parts.length == 1 ? intPart : '$intPart.${parts[1]}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final badgeColor =
        parseHexColor(product.badgeColor, fallback: Prom9Colors.primary);

    return ListTile(
      onTap: onTap,
      selected: selected,
      selectedTileColor: theme.colorScheme.primaryContainer.withValues(alpha: 0.25),
      leading: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: SizedBox(
          width: 48,
          height: 48,
          child: Image.network(
            product.imageUrl,
            fit: BoxFit.cover,
            errorBuilder: (_, __, ___) => Container(
              color: theme.colorScheme.surfaceContainerHighest,
              child: const Icon(Icons.image_not_supported_outlined, size: 20),
            ),
          ),
        ),
      ),
      title: Text(product.name, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Row(
        children: [
          Text(product.code, style: theme.textTheme.bodySmall),
          const SizedBox(width: 8),
          if (product.hasDiscount) ...[
            Text(
              '฿${_money(product.priceNormal!)}',
              style: theme.textTheme.bodySmall?.copyWith(
                decoration: TextDecoration.lineThrough,
                color: theme.colorScheme.outline,
              ),
            ),
            const SizedBox(width: 4),
          ],
          if (product.effectivePrice != null)
            Text(
              '฿${_money(product.effectivePrice!)}',
              style: theme.textTheme.bodySmall?.copyWith(
                color: Prom9Colors.primary,
                fontWeight: FontWeight.bold,
              ),
            ),
          if (product.badgeText != null) ...[
            const SizedBox(width: 8),
            Flexible(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                decoration: BoxDecoration(
                  color: badgeColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  product.badgeText!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelSmall?.copyWith(color: badgeColor),
                ),
              ),
            ),
          ],
        ],
      ),
      trailing: Icon(
        selected ? Icons.check_circle : Icons.radio_button_unchecked,
        color: selected ? Prom9Colors.primary : theme.colorScheme.outlineVariant,
      ),
    );
  }
}
