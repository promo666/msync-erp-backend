const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('owner', 'admin'));

router.get('/inventory', (req, res) => {
  const logs = db.prepare(
    `SELECT il.*, p.name AS product_name, p.sku, u.full_name AS user_name
     FROM inventory_logs il
     LEFT JOIN products p ON p.id = il.product_id
     LEFT JOIN users u ON u.id = il.user_id
     ORDER BY il.created_at DESC LIMIT 500`
  ).all();
  res.json(logs);
});

router.get('/audit', requireRole('owner'), (req, res) => {
  const logs = db.prepare(
    `SELECT a.*, u.full_name AS user_name
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC LIMIT 500`
  ).all();
  res.json(logs);
});

module.exports = router;
