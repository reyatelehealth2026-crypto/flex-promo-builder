/// Product DAO: batch upsert for 10k SKUs + FTS5 prefix search.
library;

import 'dart:convert';

import 'package:sqlite3/sqlite3.dart';

import '../../core/models/models.dart';
import 'app_database.dart';

class ProductDao {
  ProductDao(this._db);

  final AppDatabase _db;

  Database get _raw => _db.db;

  // ---- writes ---------------------------------------------------------------

  /// Upsert a whole catalog (designed for ~10k SKUs): one transaction, one
  /// prepared statement. On a phone-class device this lands well under a
  /// second; calls are synchronous FFI so there is no per-row channel cost.
  void insertBatch(List<Product> products) {
    final stmt = _raw.prepare('''
      INSERT INTO products (
        code, name, image_url, price_normal, price_sale, promo_type,
        badge_text, badge_color, expire_text, stock_text, points_text,
        note, unit_text, tags_json, promo_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name,
        image_url = excluded.image_url,
        price_normal = excluded.price_normal,
        price_sale = excluded.price_sale,
        promo_type = excluded.promo_type,
        badge_text = excluded.badge_text,
        badge_color = excluded.badge_color,
        expire_text = excluded.expire_text,
        stock_text = excluded.stock_text,
        points_text = excluded.points_text,
        note = excluded.note,
        unit_text = excluded.unit_text,
        tags_json = excluded.tags_json,
        promo_json = excluded.promo_json
    ''');
    _raw.execute('BEGIN;');
    try {
      for (final p in products) {
        stmt.execute([
          p.code,
          p.name,
          p.imageUrl,
          p.priceNormal,
          p.priceSale,
          p.promoType,
          p.badgeText,
          p.badgeColor,
          p.expireText,
          p.stockText,
          p.pointsText,
          p.note,
          p.unitText,
          p.tags == null ? null : jsonEncode(p.tags),
          p.promo == null ? null : jsonEncode(p.promo!.toJson()),
        ]);
      }
      _raw.execute('COMMIT;');
    } catch (_) {
      _raw.execute('ROLLBACK;');
      rethrow;
    } finally {
      stmt.dispose();
    }
  }

  void clear() => _raw.execute('DELETE FROM products;');

  int count() => _raw.select('SELECT COUNT(*) AS c FROM products;').first['c'] as int;

  // ---- reads ----------------------------------------------------------------

  /// Search with optional promo-type filter.
  ///
  /// * empty query  -> plain scan ordered by code.
  /// * non-empty    -> FTS5 `MATCH` with per-token prefix queries
  ///                   (`"vita"* "c"*`), ranked by bm25. If FTS finds nothing
  ///                   (typically unspaced-Thai substrings, which unicode61
  ///                   tokenizes as one long token), falls back to LIKE on
  ///                   name/code so Thai search still works.
  List<Product> search({
    String query = '',
    String? promoType,
    int limit = 300,
    int offset = 0,
  }) {
    final q = query.trim();
    if (q.isEmpty) {
      final where = promoType == null ? '' : 'WHERE promo_type = ?';
      final rows = _raw.select(
        'SELECT * FROM products $where ORDER BY code LIMIT ? OFFSET ?;',
        [if (promoType != null) promoType, limit, offset],
      );
      return rows.map(_fromRow).toList();
    }

    final match = ftsPrefixQuery(q);
    final promoFilter = promoType == null ? '' : 'AND p.promo_type = ?';
    final viaFts = _raw.select(
      '''
      SELECT p.* FROM products_fts f
      JOIN products p ON p.id = f.rowid
      WHERE products_fts MATCH ? $promoFilter
      ORDER BY rank
      LIMIT ? OFFSET ?;
      ''',
      [match, if (promoType != null) promoType, limit, offset],
    );
    if (viaFts.isNotEmpty) return viaFts.map(_fromRow).toList();

    // LIKE fallback (substring; covers unspaced Thai).
    final like = '%${q.replaceAll('%', r'\%').replaceAll('_', r'\_')}%';
    final rows = _raw.select(
      '''
      SELECT * FROM products
      WHERE (name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\')
        ${promoType == null ? '' : 'AND promo_type = ?'}
      ORDER BY code LIMIT ? OFFSET ?;
      ''',
      [like, like, if (promoType != null) promoType, limit, offset],
    );
    return rows.map(_fromRow).toList();
  }

  /// Fetch a specific selection (preserves [codes] order).
  List<Product> byCodes(List<String> codes) {
    if (codes.isEmpty) return const [];
    final placeholders = List.filled(codes.length, '?').join(',');
    final rows = _raw.select(
      'SELECT * FROM products WHERE code IN ($placeholders);',
      codes,
    );
    final byCode = {for (final r in rows.map(_fromRow)) r.code: r};
    return [
      for (final c in codes)
        if (byCode[c] != null) byCode[c]!,
    ];
  }

  /// Build an FTS5 query string where every whitespace-separated token
  /// becomes a quoted prefix term: `vita c1` -> `"vita"* "c1"*`.
  static String ftsPrefixQuery(String input) => input
      .trim()
      .split(RegExp(r'\s+'))
      .where((t) => t.isNotEmpty)
      .map((t) => '"${t.replaceAll('"', '""')}"*')
      .join(' ');

  Product _fromRow(Row row) => Product(
        code: row['code'] as String,
        name: row['name'] as String,
        imageUrl: row['image_url'] as String,
        priceNormal: (row['price_normal'] as num?)?.toDouble(),
        priceSale: (row['price_sale'] as num?)?.toDouble(),
        promoType: row['promo_type'] as String,
        badgeText: row['badge_text'] as String?,
        badgeColor: row['badge_color'] as String?,
        expireText: row['expire_text'] as String?,
        stockText: row['stock_text'] as String?,
        pointsText: row['points_text'] as String?,
        note: row['note'] as String?,
        unitText: row['unit_text'] as String?,
        tags: row['tags_json'] == null
            ? null
            : (jsonDecode(row['tags_json'] as String) as List<dynamic>).cast<String>(),
        promo: row['promo_json'] == null
            ? null
            : PromoInfo.fromJson(
                jsonDecode(row['promo_json'] as String) as Map<String, dynamic>),
      );
}
