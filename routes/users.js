const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit, genId } = require('../helpers');

const router = express.Router();
router.use(requireAuth);

// Owner and admin can view the team; only owner can create/edit/deactivate.
// Everything is scoped to the logged-in user's own warehouse.
router.get('/', requireRole('owner', 'admin'), (req, res) => {
  const users = db.prepare(
    'SELECT id, email, full_name, role, is_active, created_at FROM users WHERE warehouse_id = ? ORDER BY created_at DESC'
  ).all(req.user.warehouse_id);
  res.json(users);
});

router.post('/', requireRole('owner'), (req, res) => {
  const { email, full_name, role, password } = req.body;
  if (!email || !full_name || !role || !password) {
    return res.status(400).json({ error: 'email, full_name, role and password are all required' });
  }
  if (!['owner', 'admin', 'salesman'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const normalizedEmail = email.toLowerCase().trim();
  // Email only needs to be unique WITHIN this warehouse — the same email can
  // be an owner of one warehouse and a salesman of another, since warehouses
  // are fully independent.
  const existing = db.prepare('SELECT id FROM users WHERE warehouse_id = ? AND email = ?').get(req.user.warehouse_id, normalizedEmail);
  if (existing) return res.status(409).json({ error: 'A user with this email already exists in your warehouse' });

  const hash = bcrypt.hashSync(password, 12);
  const id = genId('user');

  db.prepare(
    `INSERT INTO users (id, warehouse_id, email, password_hash, full_name, role, is_active, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0)`
  ).run(id, req.user.warehouse_id, normalizedEmail, hash, full_name, role);

  logAudit('USER_CREATED', 'user', id, req.user.id, { email: normalizedEmail, role }, req.user.warehouse_id);

  res.status(201).json({ id, email: normalizedEmail, full_name, role });
});

function getOwnedUser(req, res) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user || user.warehouse_id !== req.user.warehouse_id) {
    res.status(404).json({ error: 'User not found' });
    return null;
  }
  return user;
}

router.patch('/:id/status', requireRole('owner'), (req, res) => {
  const { is_active } = req.body;
  const user = getOwnedUser(req, res);
  if (!user) return;
  if (user.id === req.user.id) return res.status(400).json({ error: "You can't deactivate your own account" });

  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, req.params.id);
  logAudit(is_active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', 'user', req.params.id, req.user.id, null, req.user.warehouse_id);
  res.json({ ok: true });
});

router.post('/:id/reset-password', requireRole('owner'), (req, res) => {
  const { password } = req.body;
  const user = getOwnedUser(req, res);
  if (!user) return;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const hash = bcrypt.hashSync(password, 12);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, req.params.id);
  logAudit('PASSWORD_RESET_BY_OWNER', 'user', req.params.id, req.user.id, null, req.user.warehouse_id);
  res.json({ ok: true });
});

module.exports = router;
