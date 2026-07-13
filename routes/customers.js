const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit, genId } = require('../helpers');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM customers WHERE warehouse_id = ? ORDER BY name ASC').all(req.user.warehouse_id));
});

router.get('/:id', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer || customer.warehouse_id !== req.user.warehouse_id) return res.status(404).json({ error: 'Customer not found' });
  res.json(customer);
});

// Order history for a customer
router.get('/:id/sales', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer || customer.warehouse_id !== req.user.warehouse_id) return res.status(404).json({ error: 'Customer not found' });

  const sales = db.prepare(
    `SELECT s.*, u.full_name AS salesman_name FROM sales s JOIN users u ON u.id = s.salesman_id
     WHERE s.customer_id = ? ORDER BY s.created_at DESC`
  ).all(req.params.id);

  const payments = db.prepare(
    `SELECT * FROM customer_payments WHERE customer_id = ? ORDER BY created_at DESC`
  ).all(req.params.id);

  res.json({ customer, sales, payments });
});

router.post('/', requireRole('owner', 'admin'), (req, res) => {
  const { name, phone, email, address, credit_limit, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = genId('customer');
  db.prepare(
    `INSERT INTO customers (id, warehouse_id, name, phone, email, address, credit_limit, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, req.user.warehouse_id, name, phone || '', email || '', address || '', credit_limit || 0, notes || '');
  logAudit('CUSTOMER_CREATED', 'customer', id, req.user.id, { name }, req.user.warehouse_id);
  res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
});

router.put('/:id', requireRole('owner', 'admin'), (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer || customer.warehouse_id !== req.user.warehouse_id) return res.status(404).json({ error: 'Customer not found' });
  const { name, phone, email, address, credit_limit, notes, is_active } = req.body;
  db.prepare(
    `UPDATE customers SET name=?, phone=?, email=?, address=?, credit_limit=?, notes=?, is_active=? WHERE id=?`
  ).run(
    name ?? customer.name,
    phone ?? customer.phone,
    email ?? customer.email,
    address ?? customer.address,
    credit_limit ?? customer.credit_limit,
    notes ?? customer.notes,
    is_active === undefined ? customer.is_active : (is_active ? 1 : 0),
    req.params.id
  );
  logAudit('CUSTOMER_UPDATED', 'customer', req.params.id, req.user.id, null, req.user.warehouse_id);
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id));
});

// Record a payment against a customer's outstanding credit balance
router.post('/:id/payments', requireRole('owner', 'admin'), (req, res) => {
  const { amount, note } = req.body;
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer || customer.warehouse_id !== req.user.warehouse_id) return res.status(404).json({ error: 'Customer not found' });

  const amt = parseFloat(amount);
  if (Number.isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Enter a valid payment amount' });

  const tx = db.transaction(() => {
    db.prepare('INSERT INTO customer_payments (customer_id, amount, note, user_id) VALUES (?, ?, ?, ?)').run(req.params.id, amt, note || '', req.user.id);
    const newBalance = customer.credit_balance - amt;
    db.prepare('UPDATE customers SET credit_balance = ? WHERE id = ?').run(newBalance, req.params.id);
    return newBalance;
  });
  const newBalance = tx();

  logAudit('CUSTOMER_PAYMENT', 'customer', req.params.id, req.user.id, { amount: amt }, req.user.warehouse_id);
  res.json({ ok: true, new_balance: newBalance });
});

module.exports = router;
