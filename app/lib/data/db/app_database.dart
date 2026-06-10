/// SQLite database (package:sqlite3 + sqlite3_flutter_libs).
///
/// Why this stack instead of sqflite: sqflite links the OS-provided SQLite
/// where FTS5 availability varies by Android/iOS version; sqlite3_flutter_libs
/// bundles a current SQLite compiled WITH FTS5 on all platforms, and the
/// synchronous FFI API makes the 10k-SKU batch insert (one transaction, one
/// prepared statement) fast with no platform-channel overhead.
///
/// Schema: `products` is the source of truth; `products_fts` is an external-
/// content FTS5 table over (code, name, note, tags) kept in sync by triggers,
/// so search storage is not duplicated and rebuilds are one `INSERT ...
/// ('rebuild')` away.
library;

import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqlite3/sqlite3.dart';

const int _schemaVersion = 1;

const String _schema = '''
CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  image_url    TEXT NOT NULL DEFAULT '',
  price_normal REAL,
  price_sale   REAL,
  promo_type   TEXT NOT NULL DEFAULT 'custom',
  badge_text   TEXT,
  badge_color  TEXT,
  expire_text  TEXT,
  stock_text   TEXT,
  points_text  TEXT,
  note         TEXT,
  unit_text    TEXT,
  tags_json    TEXT,
  promo_json   TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_promo_type ON products(promo_type);

-- External-content FTS5 over the searchable columns. unicode61 with
-- remove_diacritics handles Latin codes + spaced Thai; the DAO adds a LIKE
-- fallback for unspaced-Thai substring queries (see product_dao.dart).
CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
  code, name, note, tags,
  content='products',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS products_ai AFTER INSERT ON products BEGIN
  INSERT INTO products_fts(rowid, code, name, note, tags)
  VALUES (new.id, new.code, new.name, coalesce(new.note,''), coalesce(new.tags_json,''));
END;

CREATE TRIGGER IF NOT EXISTS products_ad AFTER DELETE ON products BEGIN
  INSERT INTO products_fts(products_fts, rowid, code, name, note, tags)
  VALUES ('delete', old.id, old.code, old.name, coalesce(old.note,''), coalesce(old.tags_json,''));
END;

CREATE TRIGGER IF NOT EXISTS products_au AFTER UPDATE ON products BEGIN
  INSERT INTO products_fts(products_fts, rowid, code, name, note, tags)
  VALUES ('delete', old.id, old.code, old.name, coalesce(old.note,''), coalesce(old.tags_json,''));
  INSERT INTO products_fts(rowid, code, name, note, tags)
  VALUES (new.id, new.code, new.name, coalesce(new.note,''), coalesce(new.tags_json,''));
END;
''';

class AppDatabase {
  AppDatabase._(this.db);

  final Database db;

  /// Open (and migrate) the app database at the platform support directory.
  static Future<AppDatabase> open({String fileName = 'prom9.db'}) async {
    final dir = await getApplicationSupportDirectory();
    await Directory(dir.path).create(recursive: true);
    return openAt(p.join(dir.path, fileName));
  }

  /// Open at an explicit path ('::memory:'-style in-memory for tests via
  /// [openInMemory]).
  static AppDatabase openAt(String path) {
    final db = sqlite3.open(path);
    _configure(db);
    return AppDatabase._(db);
  }

  static AppDatabase openInMemory() {
    final db = sqlite3.openInMemory();
    _configure(db);
    return AppDatabase._(db);
  }

  static void _configure(Database db) {
    db.execute('PRAGMA journal_mode = WAL;');
    db.execute('PRAGMA foreign_keys = ON;');
    final version = db
        .select('PRAGMA user_version;')
        .first
        .columnAt(0) as int;
    if (version < _schemaVersion) {
      db.execute('BEGIN;');
      try {
        db.execute(_schema);
        db.execute('PRAGMA user_version = $_schemaVersion;');
        db.execute('COMMIT;');
      } catch (_) {
        db.execute('ROLLBACK;');
        rethrow;
      }
    }
  }

  /// Rebuild the FTS index from the content table (after bulk surgery).
  void rebuildFts() =>
      db.execute("INSERT INTO products_fts(products_fts) VALUES ('rebuild');");

  void dispose() => db.dispose();
}
