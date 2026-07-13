const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireSuperAdmin } = require('../middleware/superAuth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' }
});

// ---------- Login ----------
router.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const admin = db.prepare('SELECT * FROM super_admins WHERE email = ?').get(String(email).toLowerCase().trim());
  if (!admin || !admin.is_active || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign(
    { id: admin.id, email: admin.email, full_name: admin.full_name, type: 'superadmin' },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({ token, admin: { id: admin.id, email: admin.email, full_name: admin.full_name } });
});

router.use(requireSuperAdmin);

// ---------- List all warehouses with quick stats ----------
router.get('/warehouses', (req, res) => {
  const warehouses = db.prepare('SELECT * FROM warehouses ORDER BY created_at DESC').all();

  const statsStmt = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE warehouse_id = ? AND is_active = 1) AS active_users,
      (SELECT COUNT(*) FROM products WHERE warehouse_id = ? AND is_active = 1) AS active_products,
      (SELECT COUNT(*) FROM shops WHERE warehouse_id = ? AND is_active = 1) AS active_shops,
      (SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE warehouse_id = ? AND status = 'completed') AS total_sales,
      (SELECT COUNT(*) FROM sales WHERE warehouse_id = ? AND status = 'completed') AS total_sale_count,
      (SELECT COALESCE(SUM(credit_balance), 0) FROM shops WHERE warehouse_id = ?) AS credit_outstanding,
      (SELECT COUNT(*) FROM shops WHERE warehouse_id = ? AND credit_balance > 0) AS shops_owing
  `);

  const result = warehouses.map(w => {
    const stats = statsStmt.get(w.id, w.id, w.id, w.id, w.id, w.id, w.id);
    return { ...w, stats };
  });

  res.json(result);
});

// ---------- Combined totals + side-by-side ranking across ALL warehouses ----------
router.get('/reports/overview', (req, res) => {
  const combined = db.prepare(`
    SELECT
      COALESCE(SUM(total_amount), 0) AS total_sales,
      COUNT(*) AS total_sale_count
    FROM sales WHERE status = 'completed'
  `).get();

  const creditCombined = db.prepare(`
    SELECT COALESCE(SUM(credit_balance), 0) AS total_credit_outstanding, COUNT(*) AS shops_owing
    FROM shops WHERE credit_balance > 0
  `).get();
  combined.total_credit_outstanding = creditCombined.total_credit_outstanding;
  combined.shops_owing = creditCombined.shops_owing;

  const ranking = db.prepare(`
    SELECT
      w.id AS warehouse_id,
      w.name AS warehouse_name,
      COALESCE(SUM(s.total_amount), 0) AS total_sales,
      COUNT(s.id) AS sale_count
    FROM warehouses w
    LEFT JOIN sales s ON s.warehouse_id = w.id AND s.status = 'completed'
    GROUP BY w.id
    ORDER BY total_sales DESC
  `).all();

  const creditByWarehouse = db.prepare(`
    SELECT warehouse_id, COALESCE(SUM(credit_balance), 0) AS credit_outstanding
    FROM shops GROUP BY warehouse_id
  `).all();
  const creditMap = Object.fromEntries(creditByWarehouse.map(c => [c.warehouse_id, c.credit_outstanding]));
  ranking.forEach(r => { r.credit_outstanding = creditMap[r.warehouse_id] || 0; });

  res.json({ combined, ranking });
});

// ---------- Drill into a single warehouse's full data ----------
router.get('/warehouses/:id', (req, res) => {
  const warehouse = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(req.params.id);
  if (!warehouse) return res.status(404).json({ error: 'Warehouse not found' });
  res.json(warehouse);
});

router.get('/warehouses/:id/dashboard', (req, res) => {
  const warehouse = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(req.params.id);
  if (!warehouse) return res.status(404).json({ error: 'Warehouse not found' });

  const whId = warehouse.id;
  const totals = db.prepare(`
    SELECT COALESCE(SUM(total_amount),0) AS total_sales, COUNT(*) AS sale_count
    FROM sales WHERE warehouse_id = ? AND status = 'completed'
  `).get(whId);

  const lowStock = db.prepare(`
    SELECT id, sku, name, current_stock, low_stock_threshold
    FROM products WHERE warehouse_id = ? AND is_active = 1 AND current_stock <= low_stock_threshold
  `).all(whId);

  const topProducts = db.prepare(`
    SELECT p.id, p.name, p.sku, SUM(si.quantity) AS units_sold, SUM(si.subtotal) AS revenue
    FROM sale_items si
    JOIN products p ON p.id = si.product_id
    JOIN sales s ON s.id = si.sale_id
    WHERE s.warehouse_id = ? AND s.status = 'completed'
    GROUP BY p.id
    ORDER BY revenue DESC
    LIMIT 10
  `).all(whId);

  const recentSales = db.prepare(`
    SELECT s.*, u.full_name AS salesman_name
    FROM sales s JOIN users u ON u.id = s.salesman_id
    WHERE s.warehouse_id = ?
    ORDER BY s.created_at DESC
    LIMIT 20
  `).all(whId);

  const shopsOwing = db.prepare(`
    SELECT id, name, phone, location, credit_balance, last_credit_at
    FROM shops WHERE warehouse_id = ? AND credit_balance > 0
    ORDER BY credit_balance DESC
  `).all(whId);

  const creditSummary = shopsOwing.reduce((acc, s) => {
    acc.totalOwed += s.credit_balance;
    acc.shopsOwing += 1;
    const days = s.last_credit_at ? Math.floor((Date.now() - new Date(s.last_credit_at).getTime()) / 86400000) : null;
    if (days !== null && days > 6) { acc.overdueCount += 1; acc.overdueAmount += s.credit_balance; }
    return acc;
  }, { totalOwed: 0, shopsOwing: 0, overdueCount: 0, overdueAmount: 0 });

  res.json({ warehouse, totals, lowStock, topProducts, recentSales, shopsOwing, creditSummary });
});

// ---------- Activate / deactivate an entire warehouse ----------
router.patch('/warehouses/:id/status', (req, res) => {
  const { is_active } = req.body;
  const warehouse = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(req.params.id);
  if (!warehouse) return res.status(404).json({ error: 'Warehouse not found' });
  db.prepare('UPDATE warehouses SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
