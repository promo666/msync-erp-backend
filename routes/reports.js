const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
// Reports show profit/cost data — restrict to owner/admin, salesmen shouldn't see margins.
router.use(requireRole('owner', 'admin'));

// All endpoints accept optional ?from=YYYY-MM-DD&to=YYYY-MM-DD query params.
// If omitted, they default to "all time" for this warehouse.
function dateRange(req) {
  const from = req.query.from ? `${req.query.from} 00:00:00` : '0000-01-01';
  const to = req.query.to ? `${req.query.to} 23:59:59` : '9999-12-31';
  return { from, to };
}

// ---------- Summary: totals for the period ----------
router.get('/summary', (req, res) => {
  const { from, to } = dateRange(req);
  const warehouseId = req.user.warehouse_id;

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(s.total_amount), 0) AS total_revenue,
      COUNT(DISTINCT s.id) AS total_sales,
      COALESCE(SUM(si.quantity * p.cost_price), 0) AS total_cost
    FROM sales s
    JOIN sale_items si ON si.sale_id = s.id
    JOIN products p ON p.id = si.product_id
    WHERE s.warehouse_id = ? AND s.status = 'completed' AND s.created_at BETWEEN ? AND ?
  `).get(warehouseId, from, to);

  const profit = totals.total_revenue - totals.total_cost;
  const marginPct = totals.total_revenue > 0 ? (profit / totals.total_revenue) * 100 : 0;

  res.json({ ...totals, total_profit: profit, margin_pct: marginPct });
});

// ---------- Sales over time (daily/weekly/monthly trend) ----------
router.get('/timeseries', (req, res) => {
  const { from, to } = dateRange(req);
  const groupBy = ['day', 'week', 'month'].includes(req.query.groupBy) ? req.query.groupBy : 'day';
  const format = { day: '%Y-%m-%d', week: '%Y-W%W', month: '%Y-%m' }[groupBy];

  const rows = db.prepare(`
    SELECT strftime('${format}', s.created_at) AS period,
           COALESCE(SUM(s.total_amount), 0) AS revenue,
           COUNT(*) AS sale_count
    FROM sales s
    WHERE s.warehouse_id = ? AND s.status = 'completed' AND s.created_at BETWEEN ? AND ?
    GROUP BY period
    ORDER BY period ASC
  `).all(req.user.warehouse_id, from, to);

  res.json(rows);
});

// ---------- Best-selling products ----------
router.get('/best-sellers', (req, res) => {
  const { from, to } = dateRange(req);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

  const rows = db.prepare(`
    SELECT p.id, p.sku, p.name,
           SUM(si.quantity) AS units_sold,
           SUM(si.subtotal) AS revenue
    FROM sale_items si
    JOIN products p ON p.id = si.product_id
    JOIN sales s ON s.id = si.sale_id
    WHERE s.warehouse_id = ? AND s.status = 'completed' AND s.created_at BETWEEN ? AND ?
    GROUP BY p.id
    ORDER BY revenue DESC
    LIMIT ?
  `).all(req.user.warehouse_id, from, to, limit);

  res.json(rows);
});

// ---------- Profit margin per product ----------
router.get('/profit-margins', (req, res) => {
  const { from, to } = dateRange(req);

  const rows = db.prepare(`
    SELECT p.id, p.sku, p.name,
           SUM(si.quantity) AS units_sold,
           SUM(si.subtotal) AS revenue,
           SUM(si.quantity * p.cost_price) AS cost,
           (SUM(si.subtotal) - SUM(si.quantity * p.cost_price)) AS profit
    FROM sale_items si
    JOIN products p ON p.id = si.product_id
    JOIN sales s ON s.id = si.sale_id
    WHERE s.warehouse_id = ? AND s.status = 'completed' AND s.created_at BETWEEN ? AND ?
    GROUP BY p.id
    ORDER BY profit DESC
  `).all(req.user.warehouse_id, from, to);

  const withMargin = rows.map(r => ({
    ...r,
    margin_pct: r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0
  }));

  res.json(withMargin);
});

// ---------- Sales by shop ----------
router.get('/by-shop', (req, res) => {
  const { from, to } = dateRange(req);

  const rows = db.prepare(`
    SELECT sh.id AS shop_id, sh.name AS shop_name,
           COALESCE(SUM(s.total_amount), 0) AS revenue,
           COUNT(s.id) AS sale_count
    FROM sales s
    JOIN shops sh ON sh.id = s.shop_id
    WHERE s.warehouse_id = ? AND s.status = 'completed' AND s.created_at BETWEEN ? AND ?
    GROUP BY sh.id
    ORDER BY revenue DESC
  `).all(req.user.warehouse_id, from, to);

  const noShop = db.prepare(`
    SELECT COALESCE(SUM(s.total_amount), 0) AS revenue, COUNT(s.id) AS sale_count
    FROM sales s
    WHERE s.warehouse_id = ? AND s.status = 'completed' AND s.shop_id IS NULL AND s.created_at BETWEEN ? AND ?
  `).get(req.user.warehouse_id, from, to);

  if (noShop.sale_count > 0) {
    rows.push({ shop_id: null, shop_name: '(No shop selected)', revenue: noShop.revenue, sale_count: noShop.sale_count });
  }

  res.json(rows);
});

// ---------- Sales by salesman (performance) ----------
router.get('/by-salesman', (req, res) => {
  const { from, to } = dateRange(req);

  const rows = db.prepare(`
    SELECT u.id AS salesman_id, u.full_name AS salesman_name,
           COALESCE(SUM(s.total_amount), 0) AS revenue,
           COUNT(s.id) AS sale_count
    FROM sales s
    JOIN users u ON u.id = s.salesman_id
    WHERE s.warehouse_id = ? AND s.status = 'completed' AND s.created_at BETWEEN ? AND ?
    GROUP BY u.id
    ORDER BY revenue DESC
  `).all(req.user.warehouse_id, from, to);

  res.json(rows);
});

// ---------- Low stock / restock needed (not date-ranged, it's a current snapshot) ----------
router.get('/low-stock', (req, res) => {
  const rows = db.prepare(`
    SELECT id, sku, name, current_stock, low_stock_threshold, category
    FROM products
    WHERE warehouse_id = ? AND is_active = 1 AND current_stock <= low_stock_threshold
    ORDER BY current_stock ASC
  `).all(req.user.warehouse_id);

  res.json(rows);
});

module.exports = router;
