// Run once: adds login credentials to suppliers (so a supplier can log into
// their own portal), and shipment-tracking fields to purchase orders (truck
// driver info, entered by the supplier when they mark an order "Loaded").
//
// Usage: node add-supplier-portal.js

require('dotenv').config();
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/msync.db';
const db = new Database(dbPath);

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

const supplierCols = [
  ['login_email', 'TEXT'],
  ['password_hash', 'TEXT'],
  ['login_enabled', 'INTEGER NOT NULL DEFAULT 0']
];
for (const [name, def] of supplierCols) {
  if (!columnExists('suppliers', name)) {
    db.exec(`ALTER TABLE suppliers ADD COLUMN ${name} ${def}`);
    console.log(`Added ${name} to suppliers table.`);
  }
}

const poCols = [
  ['shipment_status', "TEXT NOT NULL DEFAULT 'awaiting'"],
  ['driver_name', 'TEXT'],
  ['driver_phone', 'TEXT'],
  ['truck_number', 'TEXT'],
  ['loaded_at', 'TEXT'],
  ['shipment_notes', 'TEXT']
];
for (const [name, def] of poCols) {
  if (!columnExists('purchase_orders', name)) {
    db.exec(`ALTER TABLE purchase_orders ADD COLUMN ${name} ${def}`);
    console.log(`Added ${name} to purchase_orders table.`);
  }
}

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_login_email ON suppliers(login_email) WHERE login_email IS NOT NULL;`);

console.log('Supplier portal is ready.');
