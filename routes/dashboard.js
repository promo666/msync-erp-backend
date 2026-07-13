const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/summary', (req, res) => {
  const isManager = req.user.role === 'owner' || req.user.role === 'admin';
  const params = isManager ? [] : [req.user.id];

  const totalSales = db.prepare(
    `SELECT COUNT(*) AS c, COALESCE(SUM(total_amount),0) AS total FROM sales
     WHERE status = 'completed' ${isManager ? '' : 'AND salesman_id = ?'}`
  ).get(...params);

  const lowStock = db.prepare('SELECT COUNT(*) AS c FROM products WHERE is_active = 1 AND current_stock <= low_stock_threshold').get();
  const totalProducts = db.prepare('SELECT COUNT(*) AS c FROM products WHERE is_active = 1').get();

  const todaySales = db.prepare(
    `SELECT COUNT(*) AS c, COALESCE(SUM(total_amount),0) AS total FROM sales
     WHERE status = 'completed' AND date(created_at) = date('now') ${isManager ? '' : 'AND salesman_id = ?'}`
  ).get(...(isManager ? [] : [req.user.id]));

  const topProducts = db.prepare(
    `SELECT p.name, p.sku, SUM(si.quantity) AS total_qty, SUM(si.subtotal) AS total_revenue
     FROM sale_items si JOIN products p ON p.id = si.product_id
     JOIN sales s ON s.id = si.sale_id
     WHERE s.status = 'completed' ${isManager ? '' : 'AND s.salesman_id = ?'}
     GROUP BY si.product_id ORDER BY total_qty DESC LIMIT 5`
  ).all(...(isManager ? [] : [req.user.id]));

  res.json({
    total_sales_count: totalSales.c,
    total_sales_amount: totalSales.total,
    today_sales_count: todaySales.c,
    today_sales_amount: todaySales.total,
    low_stock_count: lowStock.c,
    total_active_products: totalProducts.c,
    top_products: topProducts
  });
});

// Target vs achieved (owner/admin only, but route itself is open — data is safe to view for all managers)
router.get('/targets', (req, res) => {
  if (req.user.role === 'salesman') return res.status(403).json({ error: 'Not permitted' });

  const products = db.prepare('SELECT * FROM products WHERE is_active = 1').all();
  const achievedStmt = db.prepare(
    `SELECT COALESCE(SUM(si.quantity),0) AS qty
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE si.product_id = ? AND s.status = 'completed' AND strftime('%Y-%m', s.created_at) = strftime('%Y-%m','now')`
  );

  const result = products.map(p => {
    const achieved = achievedStmt.get(p.id).qty;
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      monthly_target: p.monthly_target,
      monthly_achieved: achieved,
      progress_pct: p.monthly_target > 0 ? Math.min(100, Math.round((achieved / p.monthly_target) * 100)) : 0
    };
  });
  res.json(result);
});

module.exports = router;
