// Run once: adds customers, customer_payments tables, and links sales to
// customers with a payment_method (cash/credit).
//
// Usage: node add-customers.js

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
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  credit_limit REAL NOT NULL DEFAULT 0,
  credit_balance REAL NOT NULL DEFAULT 0,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  amount REAL NOT NULL,
  note TEXT,
  user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customers_warehouse ON customers(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON customer_payments(customer_id);
`);

if (!columnExists('sales', 'customer_id')) {
  db.exec(`ALTER TABLE sales ADD COLUMN customer_id TEXT REFERENCES customers(id)`);
  console.log('Added customer_id column to sales table.');
}
if (!columnExists('sales', 'payment_method')) {
  db.exec(`ALTER TABLE sales ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'`);
  console.log('Added payment_method column to sales table (defaults to cash).');
}

console.log('Customer management tables are ready.');
