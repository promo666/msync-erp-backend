const express = require('express');
const db = require('../db');

const router = express.Router();

// Public shop statement — this is what the printed QR code links to.
// No login required (the shop owner has no account), but it only exposes
// data for the ONE shop matching this exact token — never a full list,
// never other shops, never anything warehouse-wide.
router.get('/shop-statement/:token', (req, res) => {
  const shop = db.prepare(
    `SELECT s.*, w.name AS warehouse_name, w.is_active AS warehouse_active
     FROM shops s JOIN warehouses w ON w.id = s.warehouse_id
     WHERE s.public_token = ?`
  ).get(req.params.token);

  if (!shop || !shop.is_active || !shop.warehouse_active) {
    return res.status(404).json({ error: 'This statement link is not valid' });
  }

  const sales = db.prepare(
    `SELECT s.id, s.invoice_number, s.total_amount, s.payment_method, s.status, s.created_at
     FROM sales s WHERE s.shop_id = ? ORDER BY s.created_at DESC`
  ).all(shop.id);

  const itemsStmt = db.prepare(
    `SELECT si.quantity, si.unit_price, si.subtotal, p.name AS product_name
     FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ?`
  );
  const salesWithItems = sales.map(s => ({ ...s, items: itemsStmt.all(s.id) }));

  const payments = db.prepare(
    `SELECT amount, note, created_at FROM shop_payments WHERE shop_id = ? ORDER BY created_at DESC`
  ).all(shop.id);

  res.json({
    shop: {
      name: shop.name,
      phone: shop.phone,
      location: shop.location,
      credit_balance: shop.credit_balance,
      warehouse_name: shop.warehouse_name
    },
    sales: salesWithItems,
    payments
  });
});

module.exports = router;
