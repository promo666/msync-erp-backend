// Run once: adds suppliers, purchase_orders, and purchase_order_items tables.
//
// Usage: node add-purchase-orders.js

require('dotenv').config();
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/msync.db';
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  order_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','received','cancelled')),
  total_amount REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  received_at TEXT,
  UNIQUE(warehouse_id, order_number)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_cost REAL NOT NULL,
  subtotal REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_suppliers_warehouse ON suppliers(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_po_warehouse ON purchase_orders(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(po_id);
`);

console.log('Purchase order tables are ready (suppliers, purchase_orders, purchase_order_items).');
