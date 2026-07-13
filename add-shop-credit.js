// Run once: adds credit balance tracking directly to shops (separate from
// the general Customers feature), plus a shop_payments table for recording
// when a shop pays down what they owe.
//
// Usage: node add-shop-credit.js

require('dotenv').config();
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/msync.db';
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

if (!columnExists('shops', 'credit_balance')) {
  db.exec(`ALTER TABLE shops ADD COLUMN credit_balance REAL NOT NULL DEFAULT 0`);
  console.log('Added credit_balance column to shops table.');
}
if (!columnExists('shops', 'last_credit_at')) {
  db.exec(`ALTER TABLE shops ADD COLUMN last_credit_at TEXT`);
  console.log('Added last_credit_at column to shops table.');
}

db.exec(`
CREATE TABLE IF NOT EXISTS shop_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  amount REAL NOT NULL,
  note TEXT,
  user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_shop_payments_shop ON shop_payments(shop_id);
`);

console.log('Shop credit tracking is ready.');
