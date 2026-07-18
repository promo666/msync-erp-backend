const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireSupplier } = require('../middleware/supplierAuth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' }
});

router.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const supplier = db.prepare(
    `SELECT s.*, w.name AS warehouse_name, w.is_active AS warehouse_active
     FROM suppliers s JOIN warehouses w ON w.id = s.warehouse_id
     WHERE s.login_email = ?`
  ).get(String(email).toLowerCase().trim());

  if (!supplier || !supplier.login_enabled || !supplier.is_active || !supplier.warehouse_active ||
      !bcrypt.compareSync(password, supplier.password_hash || '')) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign(
    { id: supplier.id, warehouse_id: supplier.warehouse_id, name: supplier.name, type: 'supplier' },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    supplier: { id: supplier.id, name: supplier.name, warehouse_name: supplier.warehouse_name }
  });
});

router.use(requireSupplier);

// This supplier's own purchase orders only — never another supplier's, never
// another warehouse's, enforced by matching both supplier_id AND warehouse_id.
router.get('/purchase-orders', (req, res) => {
  const orders = db.prepare(
    `SELECT * FROM purchase_orders WHERE supplier_id = ? AND warehouse_id = ? ORDER BY created_at DESC`
  ).all(req.supplier.id, req.supplier.warehouse_id);

  const itemsStmt = db.prepare(
    `SELECT poi.*, p.name AS product_name, p.sku FROM purchase_order_items poi JOIN products p ON p.id = poi.product_id WHERE poi.po_id = ?`
  );
  res.json(orders.map(po => ({ ...po, items: itemsStmt.all(po.id) })));
});

// Supplier marks an order as loaded/shipped and provides truck/driver info
// for the warehouse admin to track. This does NOT touch stock or the order's
// pending/received status — that still only changes when the warehouse
// admin actually receives the goods.
router.post('/purchase-orders/:id/mark-loaded', (req, res) => {
  const { driver_name, driver_phone, truck_number, shipment_notes } = req.body;
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po || po.supplier_id !== req.supplier.id || po.warehouse_id !== req.supplier.warehouse_id) {
    return res.status(404).json({ error: 'Purchase order not found' });
  }
  if (po.status !== 'pending') return res.status(400).json({ error: `This order is already ${po.status}` });
  if (po.shipment_status === 'loaded') return res.status(400).json({ error: 'This order is already marked as loaded' });

  db.prepare(
    `UPDATE purchase_orders SET shipment_status = 'loaded', driver_name = ?, driver_phone = ?, truck_number = ?, shipment_notes = ?, loaded_at = datetime('now') WHERE id = ?`
  ).run(driver_name || '', driver_phone || '', truck_number || '', shipment_notes || '', po.id);

  res.json({ ok: true });
});

module.exports = router;
