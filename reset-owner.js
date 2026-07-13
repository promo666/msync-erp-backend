// One-time use: resets the password for a user by email.
// Run with: node reset-owner.js youremail@company.com NewPassword123
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error('Usage: node reset-owner.js <email> <new_password>');
  process.exit(1);
}

const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
if (!user) {
  console.error(`No user found with email: ${email}`);
  console.log('Tip: run this to see all accounts that exist:');
  console.log('  node -e "require(\'dotenv\').config(); console.log(require(\'./db\').prepare(\'SELECT email, role FROM users\').all())"');
  process.exit(1);
}

const hash = bcrypt.hashSync(newPassword, 12);
db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, is_active = 1 WHERE id = ?').run(hash, user.id);

console.log(`Done. You can now log in as:
  email:    ${user.email}
  password: ${newPassword}`);
