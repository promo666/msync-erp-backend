// Run once: adds a public_token to every shop (used in the printable QR
// code / public statement link), and a shop_visits table for tracking when
// a salesman confirms visiting a shop.
//
// Usage: node add-shop-qr-visits.js

require('dotenv').config();
const Database = require('better-sqlite3');
const crypto = require('crypto');

const dbPath = process.env.DB_PATH || './data/msync.db';
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

if (!columnExists('shops', 'public_token')) {
  db.exec(`ALTER TABLE shops ADD COLUMN public_token TEXT`);
  console.log('Added public_token column to shops table.');
}

db.exec(`
CREATE TABLE IF NOT EXISTS shop_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  salesman_id TEXT NOT NULL REFERENCES users(id),
  visited_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_shop_visits_shop ON shop_visits(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_visits_warehouse ON shop_visits(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_shop_visits_salesman ON shop_visits(salesman_id);
`);

// Backfill a public_token for any shop that doesn't have one yet
const shopsNeedingToken = db.prepare('SELECT id FROM shops WHERE public_token IS NULL OR public_token = ?').all('');
const update = db.prepare('UPDATE shops SET public_token = ? WHERE id = ?');
for (const shop of shopsNeedingToken) {
  const token = crypto.randomBytes(16).toString('hex');
  update.run(token, shop.id);
}
console.log(`Generated public tokens for ${shopsNeedingToken.length} shop(s).`);

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_shops_public_token ON shops(public_token) WHERE public_token IS NOT NULL;`);

console.log('QR statement links and visit tracking are ready.');
