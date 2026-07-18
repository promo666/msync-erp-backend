const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit, genId } = require('../helpers');

const router = express.Router();
router.use(requireAuth);

router.get('/', requireRole('owner', 'admin'), (req, res) => {
  res.json(db.prepare('SELECT * FROM suppliers WHERE warehouse_id = ? ORDER BY name ASC').all(req.user.warehouse_id));
});

router.post('/', requireRole('owner', 'admin'), (req, res) => {
  const { name, contact_name, phone, email, address, login_email, password } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  // Login credentials are optional at creation time — if either is given, both are required.
  let normalizedLoginEmail = null;
  let passwordHash = null;
  if (login_email || password) {
    if (!login_email || !password) return res.status(400).json({ error: 'login_email and password must both be provided together' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    normalizedLoginEmail = login_email.toLowerCase().trim();
    const existing = db.prepare('SELECT id FROM suppliers WHERE login_email = ?').get(normalizedLoginEmail);
    if (existing) return res.status(409).json({ error: 'This email is already used for another supplier login' });
    passwordHash = bcrypt.hashSync(password, 12);
  }

  const id = genId('supplier');
  db.prepare(
    `INSERT INTO suppliers (id, warehouse_id, name, contact_name, phone, email, address, login_email, password_hash, login_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, req.user.warehouse_id, name, contact_name || '', phone || '', email || '', address || '', normalizedLoginEmail, passwordHash, normalizedLoginEmail ? 1 : 0);
  logAudit('SUPPLIER_CREATED', 'supplier', id, req.user.id, { name }, req.user.warehouse_id);
  res.status(201).json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id));
});

router.put('/:id', requireRole('owner', 'admin'), (req, res) => {
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!supplier || supplier.warehouse_id !== req.user.warehouse_id) return res.status(404).json({ error: 'Supplier not found' });
  const { name, contact_name, phone, email, address, is_active } = req.body;
  db.prepare(
    `UPDATE suppliers SET name=?, contact_name=?, phone=?, email=?, address=?, is_active=? WHERE id=?`
  ).run(
    name ?? supplier.name,
    contact_name ?? supplier.contact_name,
    phone ?? supplier.phone,
    email ?? supplier.email,
    address ?? supplier.address,
    is_active === undefined ? supplier.is_active : (is_active ? 1 : 0),
    req.params.id
  );
  logAudit('SUPPLIER_UPDATED', 'supplier', req.params.id, req.user.id, null, req.user.warehouse_id);
  res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id));
});

// Give (or update) this supplier's portal login — owner/admin sets the
// email and a password directly, same pattern as team member accounts.
router.put('/:id/login-access', requireRole('owner', 'admin'), (req, res) => {
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!supplier || supplier.warehouse_id !== req.user.warehouse_id) return res.status(404).json({ error: 'Supplier not found' });

  const { login_email, password } = req.body;
  if (!login_email || !password) return res.status(400).json({ error: 'login_email and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const normalizedEmail = login_email.toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM suppliers WHERE login_email = ? AND id != ?').get(normalizedEmail, req.params.id);
  if (existing) return res.status(409).json({ error: 'This email is already used for another supplier login' });

  const hash = bcrypt.hashSync(password, 12);
  db.prepare('UPDATE suppliers SET login_email = ?, password_hash = ?, login_enabled = 1 WHERE id = ?')
    .run(normalizedEmail, hash, req.params.id);
  logAudit('SUPPLIER_LOGIN_ACCESS_SET', 'supplier', req.params.id, req.user.id, { login_email: normalizedEmail }, req.user.warehouse_id);
  res.json({ ok: true });
});

// Revoke a supplier's portal login without deleting their record
router.post('/:id/revoke-login', requireRole('owner', 'admin'), (req, res) => {
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!supplier || supplier.warehouse_id !== req.user.warehouse_id) return res.status(404).json({ error: 'Supplier not found' });

  db.prepare('UPDATE suppliers SET login_enabled = 0 WHERE id = ?').run(req.params.id);
  logAudit('SUPPLIER_LOGIN_REVOKED', 'supplier', req.params.id, req.user.id, null, req.user.warehouse_id);
  res.json({ ok: true });
});

module.exports = router;
