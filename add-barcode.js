// Run once: adds a barcode column to products (separate from SKU, since a
// barcode is what a physical scanner reads off the product packaging).
//
// Usage: node add-barcode.js

require('dotenv').config();
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/msync.db';
const db = new Database(dbPath);

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

if (!columnExists('products', 'barcode')) {
  db.exec(`ALTER TABLE products ADD COLUMN barcode TEXT`);
  console.log('Added barcode column to products table.');
}

// A partial unique index: barcodes must be unique WITHIN a warehouse, but
// multiple products are allowed to have no barcode at all (NULL).
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique
  ON products(warehouse_id, barcode) WHERE barcode IS NOT NULL AND barcode != '';
`);

console.log('Barcode support is ready.');
