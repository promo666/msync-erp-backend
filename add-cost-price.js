// Run once: adds a cost_price column to products, so we can calculate
// profit margins (selling price - cost price) in the Reports page.
//
// Usage: node add-cost-price.js

require('dotenv').config();
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/msync.db';
const db = new Database(dbPath);

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

if (columnExists('products', 'cost_price')) {
  console.log('products.cost_price already exists. Nothing to do.');
} else {
  db.exec(`ALTER TABLE products ADD COLUMN cost_price REAL NOT NULL DEFAULT 0`);
  console.log('Added cost_price column to products table (defaulted to 0 for existing products).');
  console.log('IMPORTANT: go to your Products page and fill in the real cost price for each');
  console.log('product, otherwise profit margin reports will show 100% margin (since cost = 0).');
}
