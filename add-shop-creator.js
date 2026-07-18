// Run once: adds a created_by column to shops, so newly-added shops can be
// scoped to the salesman who added them (plus owner/admin). Existing shops
// (created before this) will have created_by = NULL, which means they stay
// visible to everyone — only NEW shops going forward get restricted.
//
// Usage: node add-shop-creator.js

require('dotenv').config();
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/msync.db';
const db = new Database(dbPath);

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

if (!columnExists('shops', 'created_by')) {
  db.exec(`ALTER TABLE shops ADD COLUMN created_by TEXT REFERENCES users(id)`);
  console.log('Added created_by column to shops table (existing shops stay visible to everyone).');
} else {
  console.log('created_by column already exists. Nothing to do.');
}
