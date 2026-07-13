const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit, genId } = require('../helpers');

const router = express.Router();
router.use(requireAuth);

router.get('/', requireRole('owner', 'admin'), (req, res) => {
  res.json(db.prepare('SELECT * FROM suppliers WHERE warehouse_id = ? ORDER BY name ASC').all(req.user.warehouse_id));
});

router.post('/', requireRole('owner', 'admin'), (req, res) => {
  const { name, contact_name, phone, email, address } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = genId('supplier');
  db.prepare(
    `INSERT INTO suppliers (id, warehouse_id, name, contact_name, phone, email, address) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, req.user.warehouse_id, name, contact_name || '', phone || '', email || '', address || '');
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

module.exports = router;
