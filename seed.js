require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const { genId } = require('./helpers');

const warehouseName = process.env.SEED_WAREHOUSE_NAME || 'Warehouse #1';
const ownerEmail = (process.env.SEED_OWNER_EMAIL || 'owner@yourcompany.com').toLowerCase();
const ownerPassword = process.env.SEED_OWNER_PASSWORD || 'ChangeMe123!';
const ownerName = process.env.SEED_OWNER_NAME || 'Owner';

// Find or create the warehouse
let warehouse = db.prepare('SELECT * FROM warehouses WHERE name = ?').get(warehouseName);
let warehouseId;
if (warehouse) {
  warehouseId = warehouse.id;
  console.log(`Using existing warehouse "${warehouseName}" (${warehouseId})`);
} else {
  warehouseId = genId('wh');
  db.prepare('INSERT INTO warehouses (id, name) VALUES (?, ?)').run(warehouseId, warehouseName);
  console.log(`Created warehouse "${warehouseName}" (${warehouseId})`);
}

const existingOwner = db.prepare('SELECT id FROM users WHERE email = ? AND warehouse_id = ?').get(ownerEmail, warehouseId);
if (existingOwner) {
  console.log(`Owner account already exists (${ownerEmail}) in this warehouse. Skipping user creation.`);
} else {
  const hash = bcrypt.hashSync(ownerPassword, 12);
  db.prepare(
    `INSERT INTO users (id, warehouse_id, email, password_hash, full_name, role, is_active, must_change_password)
     VALUES (?, ?, ?, ?, ?, 'owner', 1, 0)`
  ).run(genId('user'), warehouseId, ownerEmail, hash, ownerName);
  console.log(`Created owner account:
  warehouse: ${warehouseName}
  email:     ${ownerEmail}
  password:  ${ownerPassword}`);
}

const productCount = db.prepare('SELECT COUNT(*) AS c FROM products WHERE warehouse_id = ?').get(warehouseId).c;
if (productCount === 0) {
  const insert = db.prepare(
    `INSERT INTO products (id, warehouse_id, sku, name, description, unit_price, current_stock, low_stock_threshold, category, monthly_target, quarterly_target)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const sample = [
    ['LAPTOP-001', 'ProBook Laptop 15"', 'Business laptop with Intel i7', 899.99, 45, 10, 'Electronics', 20, 60],
    ['PHONE-001', 'SmartPhone X12', '6.1" OLED Display, 128GB', 699.99, 3, 15, 'Electronics', 30, 90],
    ['DESK-001', 'Ergonomic Office Desk', 'Height adjustable standing desk', 349.99, 12, 5, 'Furniture', 15, 45],
  ];
  for (const [sku, name, desc, price, stock, threshold, cat, mt, qt] of sample) {
    insert.run(genId('prod'), warehouseId, sku, name, desc, price, stock, threshold, cat, mt, qt);
  }
  console.log(`Seeded ${sample.length} sample products (edit or delete these from the Products page).`);
} else {
  console.log('Products already exist in this warehouse. Skipping sample product seeding.');
}

console.log('\nSeeding complete.');
