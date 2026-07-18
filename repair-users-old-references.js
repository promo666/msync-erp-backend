// REPAIR SCRIPT — fixes a side effect of the previous migration.
//
// When that migration renamed the "users" table, SQLite automatically
// rewrote every OTHER table's foreign key references to say "users_old"
// instead of "users" (this is standard SQLite behavior when renaming a
// table that others reference). After the migration dropped "users_old",
// those other tables were left pointing at a table that no longer exists,
// causing "no such table: main.users_old" errors on almost every action.
//
// This script finds every table still referencing "users_old" and rebuilds
// it to correctly reference "users" again — copying all existing data over
// unchanged, and restoring its indexes.
//
// Usage: node repair-users-old-references.js

require('dotenv').config();
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/msync.db';
const db = new Database(dbPath);
db.pragma('foreign_keys = OFF');

const tables = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql LIKE '%users_old%'`).all();

if (tables.length === 0) {
  console.log('No tables reference "users_old". Nothing to repair.');
  process.exit(0);
}

console.log(`Found ${tables.length} table(s) referencing the dropped "users_old" table:`, tables.map(t => t.name).join(', '));

const tx = db.transaction(() => {
  for (const table of tables) {
    const tmpName = `${table.name}_repair_tmp`;

    // Capture this table's indexes before we touch anything, so we can restore them after.
    const indexes = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`).all(table.name);

    db.exec(`ALTER TABLE ${table.name} RENAME TO ${tmpName};`);
    db.exec(table.sql.replace(/users_old/g, 'users')); // recreate with the ORIGINAL table name, corrected reference
    db.exec(`INSERT INTO ${table.name} SELECT * FROM ${tmpName};`);
    db.exec(`DROP TABLE ${tmpName};`);

    for (const idx of indexes) {
      db.exec(idx.sql);
    }

    console.log(`Repaired table: ${table.name}`);
  }
});
tx();

db.pragma('foreign_keys = ON');
console.log('\nRepair complete. Everything should work normally again now.');
