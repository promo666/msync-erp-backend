const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit, genId } = require('../helpers');

const router = express.Router();
router.use(requireAuth);

// Shared BOGO calculation: given a coupon and the cart's line items, figure
// out how many free units apply and the resulting discount amount. Only
// looks at the ONE product the coupon is tied to, since "5+1 free" style
// deals are always about a specific product, not the whole cart.
function calcBogoDiscount(coupon, items) {
  const matching = items.find(i => i.product_id === coupon.applies_to_product_id);
  if (!matching) return { discount: 0, freeUnits: 0 };
  const bundleSize = coupon.buy_qty + coupon.free_qty;
  const sets = Math.floor(matching.quantity / bundleSize);
  const freeUnits = sets * coupon.free_qty;
  const discount = freeUnits * matching.unit_price;
  return { discount, freeUnits };
}

router.get('/', requireRole('owner', 'admin'), (req, res) => {
  const coupons = db.prepare(
    `SELECT c.*, p.name AS product_name FROM coupons c LEFT JOIN products p ON p.id = c.applies_to_product_id
     WHERE c.warehouse_id = ? ORDER BY c.created_at DESC`
  ).all(req.user.warehouse_id);
  res.json(coupons);
});

router.post('/', requireRole('owner', 'admin'), (req, res) => {
  const { code, type, value, min_purchase, max_uses, expires_at, buy_qty, free_qty, applies_to_product_id } = req.body;
  if (!code || !type) return res.status(400).json({ error: 'code and type are required' });
  if (!['percent', 'fixed', 'bogo'].includes(type)) return res.status(400).json({ error: 'Invalid coupon type' });

  if (type === 'percent' && (!value || value <= 0 || value > 100)) return res.status(400).json({ error: 'Percent discount must be between 1 and 100' });
  if (type === 'fixed' && (!value || value <= 0)) return res.status(400).json({ error: 'Fixed discount must be greater than 0' });
  if (type === 'bogo') {
    if (!applies_to_product_id) return res.status(400).json({ error: 'Select which product this offer applies to' });
    if (!Number.isInteger(buy_qty) || buy_qty <= 0) return res.status(400).json({ error: 'Enter a valid "buy" quantity' });
    if (!Number.isInteger(free_qty) || free_qty <= 0) return res.status(400).json({ error: 'Enter a valid "free" quantity' });
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND warehouse_id = ?').get(applies_to_product_id, req.user.warehouse_id);
    if (!product) return res.status(400).json({ error: 'Selected product not found' });
  }

  const normalizedCode = code.trim().toUpperCase();
  const existing = db.prepare('SELECT id FROM coupons WHERE warehouse_id = ? AND code = ?').get(req.user.warehouse_id, normalizedCode);
  if (existing) return res.status(409).json({ error: 'A coupon with this code already exists' });

  const id = genId('coupon');
  db.prepare(
    `INSERT INTO coupons (id, warehouse_id, code, type, value, min_purchase, max_uses, expires_at, buy_qty, free_qty, applies_to_product_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, req.user.warehouse_id, normalizedCode, type, value || 0, min_purchase || 0, max_uses || null, expires_at || null,
    type === 'bogo' ? buy_qty : null, type === 'bogo' ? free_qty : null, type === 'bogo' ? applies_to_product_id : null
  );
  logAudit('COUPON_CREATED', 'coupon', id, req.user.id, { code: normalizedCode, type }, req.user.warehouse_id);
  res.status(201).json(db.prepare('SELECT * FROM coupons WHERE id = ?').get(id));
});

router.put('/:id', requireRole('owner', 'admin'), (req, res) => {
  const coupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(req.params.id);
  if (!coupon || coupon.warehouse_id !== req.user.warehouse_id) return res.status(404).json({ error: 'Coupon not found' });
  const { value, min_purchase, max_uses, expires_at, is_active, buy_qty, free_qty } = req.body;
  db.prepare(
    `UPDATE coupons SET value=?, min_purchase=?, max_uses=?, expires_at=?, is_active=?, buy_qty=?, free_qty=? WHERE id=?`
  ).run(
    value ?? coupon.value,
    min_purchase ?? coupon.min_purchase,
    max_uses === undefined ? coupon.max_uses : max_uses,
    expires_at === undefined ? coupon.expires_at : expires_at,
    is_active === undefined ? coupon.is_active : (is_active ? 1 : 0),
    buy_qty ?? coupon.buy_qty,
    free_qty ?? coupon.free_qty,
    req.params.id
  );
  logAudit('COUPON_UPDATED', 'coupon', req.params.id, req.user.id, null, req.user.warehouse_id);
  res.json(db.prepare('SELECT * FROM coupons WHERE id = ?').get(req.params.id));
});

router.delete('/:id', requireRole('owner', 'admin'), (req, res) => {
  const coupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(req.params.id);
  if (!coupon || coupon.warehouse_id !== req.user.warehouse_id) return res.status(404).json({ error: 'Coupon not found' });

  db.prepare('DELETE FROM coupons WHERE id = ?').run(req.params.id);
  // Past sales keep their coupon_code as plain text for history — deleting
  // the coupon itself doesn't touch old sales records.
  logAudit('COUPON_DELETED', 'coupon', req.params.id, req.user.id, { code: coupon.code }, req.user.warehouse_id);
  res.json({ ok: true });
});

// Preview a coupon's discount before checkout. Accepts the cart's line items
// (product_id, quantity, unit_price) so BOGO offers can be calculated too,
// not just percent/fixed which only need the subtotal.
router.post('/validate', (req, res) => {
  const { code, items } = req.body;
  if (!code) return res.status(400).json({ error: 'code is required' });
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items are required' });

  const coupon = db.prepare('SELECT * FROM coupons WHERE warehouse_id = ? AND code = ?').get(req.user.warehouse_id, String(code).trim().toUpperCase());
  if (!coupon || !coupon.is_active) return res.status(404).json({ error: 'Coupon not found or inactive' });
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return res.status(400).json({ error: 'This coupon has expired' });
  if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses) return res.status(400).json({ error: 'This coupon has reached its usage limit' });

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);

  if (coupon.type === 'bogo') {
    const { discount, freeUnits } = calcBogoDiscount(coupon, items);
    if (freeUnits === 0) {
      const product = db.prepare('SELECT name FROM products WHERE id = ?').get(coupon.applies_to_product_id);
      return res.status(400).json({ error: `Add at least ${coupon.buy_qty + coupon.free_qty} of "${product ? product.name : 'the required product'}" to the cart to use this offer` });
    }
    return res.json({ valid: true, discount_amount: discount, free_units: freeUnits, coupon });
  }

  if (subtotal < coupon.min_purchase) return res.status(400).json({ error: `Minimum purchase of ${coupon.min_purchase} required for this coupon` });
  const discount = coupon.type === 'percent' ? subtotal * (coupon.value / 100) : Math.min(coupon.value, subtotal);
  res.json({ valid: true, discount_amount: discount, coupon });
});

module.exports = router;
