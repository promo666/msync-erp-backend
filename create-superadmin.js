// Creates a super-admin account. Run this whenever you need to add one.
// This is intentionally NOT exposed as a public API route — super admin
// accounts should only ever be created by someone with direct access to
// the server, for security.
//
// Usage:
//   SUPERADMIN_EMAIL=you@yourcompany.com SUPERADMIN_PASSWORD=somethingstrong SUPERADMIN_NAME="Mohammed" node create-superadmin.js
// Or just run "node create-superadmin.js" to use the defaults below.

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const { genId } = require('./helpers');

const email = (process.env.SUPERADMIN_EMAIL || 'moh19892003@gmail.com').toLowerCase().trim();
const password = process.env.SUPERADMIN_PASSWORD || 'SuperAdmin2026!';
const fullName = process.env.SUPERADMIN_NAME || 'Mohammed Salim';

const existing = db.prepare('SELECT id FROM super_admins WHERE email = ?').get(email);
if (existing) {
  console.log(`A super admin with email ${email} already exists. Nothing to do.`);
  process.exit(0);
}

const hash = bcrypt.hashSync(password, 12);
const id = genId('superadmin');
db.prepare(
  `INSERT INTO super_admins (id, email, password_hash, full_name, is_active) VALUES (?, ?, ?, ?, 1)`
).run(id, email, hash, fullName);

console.log(`Super admin account created:
  email:    ${email}
  password: ${password}
Log in at the super-admin login screen with these credentials.`);
