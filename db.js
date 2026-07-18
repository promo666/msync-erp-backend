const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dbPath = process.env.DB_PATH || './data/msync.db';
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

// WAL mode = better concurrent read/write behavior for many simultaneous users
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','admin','salesman')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  UNIQUE(warehouse_id, email)
);

CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  name TEXT NOT NULL,
  owner_name TEXT,
  phone TEXT,
  location TEXT,
  latitude REAL,
  longitude REAL,
  credit_balance REAL NOT NULL DEFAULT 0,
  last_credit_at TEXT,
  public_token TEXT,
  created_by TEXT REFERENCES users(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shop_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  salesman_id TEXT NOT NULL REFERENCES users(id),
  visited_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shop_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  amount REAL NOT NULL,
  note TEXT,
  user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  sku TEXT NOT NULL,
  barcode TEXT,
  name TEXT NOT NULL,
  description TEXT,
  unit_price REAL NOT NULL,
  cost_price REAL NOT NULL DEFAULT 0,
  current_stock INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  category TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  monthly_target INTEGER DEFAULT 0,
  quarterly_target INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(warehouse_id, sku)
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  shop_id TEXT REFERENCES shops(id),
  customer_id TEXT REFERENCES customers(id),
  payment_method TEXT NOT NULL DEFAULT 'cash',
  discount_amount REAL NOT NULL DEFAULT 0,
  coupon_code TEXT,
  invoice_number TEXT NOT NULL,
  salesman_id TEXT NOT NULL REFERENCES users(id),
  customer_name TEXT,
  customer_phone TEXT,
  total_amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(warehouse_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  subtotal REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id),
  change_type TEXT NOT NULL,
  quantity_change INTEGER NOT NULL,
  previous_stock INTEGER NOT NULL,
  new_stock INTEGER NOT NULL,
  note TEXT,
  user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_id TEXT REFERENCES warehouses(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  user_id TEXT REFERENCES users(id),
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS coupons (
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

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  login_email TEXT,
  password_hash TEXT,
  login_enabled INTEGER NOT NULL DEFAULT 0,
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
  shipment_status TEXT NOT NULL DEFAULT 'awaiting',
  driver_name TEXT,
  driver_phone TEXT,
  truck_number TEXT,
  loaded_at TEXT,
  shipment_notes TEXT,
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

CREATE INDEX IF NOT EXISTS idx_users_warehouse ON users(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_shops_warehouse ON shops(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_shop_payments_shop ON shop_payments(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_visits_shop ON shop_visits(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_visits_warehouse ON shop_visits(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_shop_visits_salesman ON shop_visits(salesman_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shops_public_token ON shops(public_token) WHERE public_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_warehouse ON products(warehouse_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique ON products(warehouse_id, barcode) WHERE barcode IS NOT NULL AND barcode != '';
CREATE INDEX IF NOT EXISTS idx_sales_warehouse ON sales(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_sales_salesman ON sales(salesman_id);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory_logs(product_id);
CREATE INDEX IF NOT EXISTS idx_coupons_warehouse ON coupons(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_customers_warehouse ON customers(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON customer_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_warehouse ON suppliers(warehouse_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_login_email ON suppliers(login_email) WHERE login_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_warehouse ON purchase_orders(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(po_id);
`);

module.exports = db;
