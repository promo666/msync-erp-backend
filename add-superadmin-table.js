// Run this once, after the warehouse migration, to add support for a
// separate "super admin" login that can see across ALL warehouses.
//
// Usage:  node add-superadmin-table.js

require('dotenv').config();
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/msync.db';
const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS super_admins (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

console.log('super_admins table is ready.');
