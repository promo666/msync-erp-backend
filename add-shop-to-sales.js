// Run once: adds a shop_id column to the sales table, so each sale can be
// linked to the shop it was sold to (needed to show the shop's location on
// the printed invoice).
//
// Usage: node add-shop-to-sales.js

require('dotenv').config();
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/msync.db';
const db = new Database(dbPath);

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

if (columnExists('sales', 'shop_id')) {
  console.log('sales.shop_id already exists. Nothing to do.');
} else {
  db.exec(`ALTER TABLE sales ADD COLUMN shop_id TEXT REFERENCES shops(id)`);
  console.log('Added shop_id column to sales table.');
}
