// Run once: adds support for "Buy X, Get Y Free" style coupons, tied to a
// specific product. SQLite can't just ALTER a CHECK constraint, so this
// rebuilds the coupons table with the expanded constraint and copies your
// existing coupons over unchanged.
//
// Usage: node add-bogo-coupons.js

require('dotenv').config();
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/msync.db';
const db = new Database(dbPath);

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

if (columnExists('coupons', 'buy_qty')) {
  console.log('BOGO coupon support already installed. Nothing to do.');
  process.exit(0);
}

db.pragma('foreign_keys = OFF');
const tx = db.transaction(() => {
  db.exec(`ALTER TABLE coupons RENAME TO coupons_old;`);

  db.exec(`
    CREATE TABLE coupons (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      code TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('percent','fixed','bogo')),
      value REAL NOT NULL DEFAULT 0,
      min_purchase REAL NOT NULL DEFAULT 0,
      max_uses INTEGER,
      uses_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      buy_qty INTEGER,
      free_qty INTEGER,
      applies_to_product_id TEXT REFERENCES products(id),
      UNIQUE(warehouse_id, code)
    );
  `);

  db.exec(`
    INSERT INTO coupons (id, warehouse_id, code, type, value, min_purchase, max_uses, uses_count, expires_at, is_active, created_at)
    SELECT id, warehouse_id, code, type, value, min_purchase, max_uses, uses_count, expires_at, is_active, created_at FROM coupons_old;
  `);

  db.exec(`DROP TABLE coupons_old;`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_coupons_warehouse ON coupons(warehouse_id);`);
});
tx();
db.pragma('foreign_keys = ON');

console.log('Coupons table upgraded: "Buy X, Get Y Free" offers are now supported.');
