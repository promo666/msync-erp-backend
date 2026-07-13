// ONE-TIME MIGRATION SCRIPT
// Run this ONCE, after replacing db.js with the new version, to convert your
// existing data (created before warehouses existed) into "Warehouse #1".
//
// Usage:  node migrate-to-warehouses.js
//
// Safe to run only once. If warehouse_id columns already have values, it
// will tell you there's nothing to migrate and stop.

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || './data/msync.db';
const db = new Database(dbPath);
db.pragma('foreign_keys = OFF'); // temporarily, while we backfill

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

function addColumnIfMissing(table, columnDef, columnName) {
  if (!columnExists(table, columnName)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
    console.log(`Added column ${columnName} to ${table}`);
  }
}

console.log('Starting migration to multi-warehouse schema...\n');

// 1. Make sure the warehouses table exists
db.exec(`
CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// 2. Add warehouse_id columns to old tables if they don't have them yet
addColumnIfMissing('users', 'warehouse_id TEXT', 'warehouse_id');
addColumnIfMissing('shops', 'warehouse_id TEXT', 'warehouse_id');
addColumnIfMissing('products', 'warehouse_id TEXT', 'warehouse_id');
addColumnIfMissing('sales', 'warehouse_id TEXT', 'warehouse_id');
addColumnIfMissing('shops', 'latitude REAL', 'latitude');
addColumnIfMissing('shops', 'longitude REAL', 'longitude');
addColumnIfMissing('audit_logs', 'warehouse_id TEXT', 'warehouse_id');

// 3. Check if migration already happened
const alreadyMigrated = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE warehouse_id IS NOT NULL`).get().c;
const totalUsers = db.prepare(`SELECT COUNT(*) AS c FROM users`).get().c;

if (totalUsers > 0 && alreadyMigrated === totalUsers) {
  console.log('\nAll users already have a warehouse_id assigned. Nothing to migrate.');
  process.exit(0);
}

// 4. Create "Warehouse #1" and assign everything to it
const existingWarehouse = db.prepare(`SELECT id FROM warehouses ORDER BY created_at ASC LIMIT 1`).get();
let warehouseId;

if (existingWarehouse) {
  warehouseId = existingWarehouse.id;
  console.log(`Using existing warehouse: ${warehouseId}`);
} else {
  warehouseId = 'wh-' + Date.now().toString().slice(-8);
  db.prepare(`INSERT INTO warehouses (id, name) VALUES (?, ?)`).run(warehouseId, 'Warehouse #1');
  console.log(`Created "Warehouse #1" with id ${warehouseId}`);
}

const tx = db.transaction(() => {
  db.prepare(`UPDATE users SET warehouse_id = ? WHERE warehouse_id IS NULL`).run(warehouseId);
  db.prepare(`UPDATE shops SET warehouse_id = ? WHERE warehouse_id IS NULL`).run(warehouseId);
  db.prepare(`UPDATE products SET warehouse_id = ? WHERE warehouse_id IS NULL`).run(warehouseId);
  db.prepare(`UPDATE sales SET warehouse_id = ? WHERE warehouse_id IS NULL`).run(warehouseId);
});
tx();

console.log('\nMigration complete! All your existing users, shops, products, and sales');
console.log(`now belong to "Warehouse #1" (id: ${warehouseId}).`);
console.log('\nIMPORTANT: your old users.json/seed script may try to re-create the owner');
console.log('account without a warehouse_id — make sure to update seed.js too (see the');
console.log('README that came with this upgrade).');

db.pragma('foreign_keys = ON');
