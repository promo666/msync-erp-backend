// Run once: expands the users.role CHECK constraint to allow a new role,
// 'sales_supervisor'. SQLite can't just alter a CHECK constraint, so this
// rebuilds the users table with the wider constraint and copies your
// existing users over unchanged.
//
// Usage: node add-sales-supervisor-role.js

require('dotenv').config();
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/msync.db';
const db = new Database(dbPath);
db.pragma('foreign_keys = OFF');

// Quick check: if this already worked, the CHECK constraint already allows it.
try {
  db.prepare("INSERT INTO users (id, warehouse_id, email, password_hash, full_name, role) VALUES ('__test__', '__test__', '__test__', '__test__', '__test__', 'sales_supervisor')").run();
  db.prepare("DELETE FROM users WHERE id = '__test__'").run();
  console.log('sales_supervisor role already allowed. Nothing to do.');
  process.exit(0);
} catch (e) {
  // expected to fail on a fresh/older schema — proceed with the rebuild below
}

const tx = db.transaction(() => {
  db.exec(`ALTER TABLE users RENAME TO users_old;`);

  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','admin','salesman','sales_supervisor')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      must_change_password INTEGER NOT NULL DEFAULT 0,
      UNIQUE(warehouse_id, email)
    );
  `);

  db.exec(`
    INSERT INTO users (id, warehouse_id, email, password_hash, full_name, role, is_active, created_at, must_change_password)
    SELECT id, warehouse_id, email, password_hash, full_name, role, is_active, created_at, must_change_password FROM users_old;
  `);

  db.exec(`DROP TABLE users_old;`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_warehouse ON users(warehouse_id);`);
});
tx();
db.pragma('foreign_keys = ON');

console.log('Users table upgraded: "Sales Supervisor" role is now available.');
