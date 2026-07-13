// Run once: adds a coupons table, and discount tracking columns on sales.
//
// Usage: node add-coupons.js

require('dotenv').config();
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/msync.db';
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

db.exec(`
CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  code TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('percent','fixed')),
  value REAL NOT NULL,
  min_purchase REAL NOT NULL DEFAULT 0,
  max_uses INTEGER,
  uses_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(warehouse_id, code)
);
CREATE INDEX IF NOT EXISTS idx_coupons_warehouse ON coupons(warehouse_id);
`);

if (!columnExists('sales', 'discount_amount')) {
  db.exec(`ALTER TABLE sales ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0`);
  console.log('Added discount_amount column to sales table.');
}
if (!columnExists('sales', 'coupon_code')) {
  db.exec(`ALTER TABLE sales ADD COLUMN coupon_code TEXT`);
  console.log('Added coupon_code column to sales table.');
}

console.log('Coupons/discounts tables are ready.');
