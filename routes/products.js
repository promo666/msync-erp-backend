const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit, logInventory, genId } = require('../helpers');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE warehouse_id = ? ORDER BY name ASC').all(req.user.warehouse_id);
  res.json(products);
});

router.post('/', requireRole('owner', 'admin'), (req, res) => {
  const { sku, barcode, name, description, unit_price, cost_price, current_stock, low_stock_threshold, category, monthly_target, quarterly_target } = req.body;
  if (!sku || !name || unit_price == null) return res.status(400).json({ error: 'sku, name and unit_price are required' });

  const existing = db.prepare('SELECT id FROM products WHERE warehouse_id = ? AND sku = ?').get(req.user.warehouse_id, sku);
  if (existing) return res.status(409).json({ error: 'A product with this SKU already exists in your warehouse' });

  if (barcode) {
    const barcodeExists = db.prepare('SELECT id FROM products WHERE warehouse_id = ? AND barcode = ?').get(req.user.warehouse_id, barcode);
    if (barcodeExists) return res.status(409).json({ error: 'A product with this barcode already exists in your warehouse' });
  }

  const id = genId('prod');
  db.prepare(
    `INSERT INTO products (id, warehouse_id, sku, barcode, name, description, unit_price, cost_price, current_stock, low_stock_threshold, category, monthly_target, quarterly_target)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, req.user.warehouse_id, sku, barcode || null, name, description || '', unit_price, cost_price || 0, current_stock || 0, low_stock_threshold || 5, category || '', monthly_target || 0, quarterly_target || 0);

  if (current_stock > 0) {
    logInventory(id, 'initial_stock', current_stock, 0, current_stock, 'Initial stock on product creation', req.user.id);
  }
  logAudit('PRODUCT_CREATED', 'product', id, req.user.id, { sku, name }, req.user.warehouse_id);
  res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
});

function getOwnedProduct(req, res) {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product || product.warehouse_id !== req.user.warehouse_id) {
    res.status(404).json({ error: 'Product not found' });
    return null;
  }
  return product;
}

router.put('/:id', requireRole('owner', 'admin'), (req, res) => {
  const product = getOwnedProduct(req, res);
  if (!product) return;

  const { name, barcode, description, unit_price, cost_price, low_stock_threshold, category, is_active, monthly_target, quarterly_target } = req.body;

  if (barcode && barcode !== product.barcode) {
    const barcodeExists = db.prepare('SELECT id FROM products WHERE warehouse_id = ? AND barcode = ? AND id != ?').get(req.user.warehouse_id, barcode, req.params.id);
    if (barcodeExists) return res.status(409).json({ error: 'A product with this barcode already exists in your warehouse' });
  }

  db.prepare(
    `UPDATE products SET name = ?, barcode = ?, description = ?, unit_price = ?, cost_price = ?, low_stock_threshold = ?, category = ?, is_active = ?, monthly_target = ?, quarterly_target = ? WHERE id = ?`
  ).run(
    name ?? product.name,
    barcode === undefined ? product.barcode : (barcode || null),
    description ?? product.description,
    unit_price ?? product.unit_price,
    cost_price ?? product.cost_price,
    low_stock_threshold ?? product.low_stock_threshold,
    category ?? product.category,
    is_active === undefined ? product.is_active : (is_active ? 1 : 0),
    monthly_target ?? product.monthly_target,
    quarterly_target ?? product.quarterly_target,
    req.params.id
  );
  logAudit('PRODUCT_UPDATED', 'product', req.params.id, req.user.id, null, req.user.warehouse_id);
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
});

// Manual stock adjustment (restock, correction, damage, etc.)
router.post('/:id/adjust-stock', requireRole('owner', 'admin'), (req, res) => {
  const { quantity_change, note } = req.body;
  if (!Number.isInteger(quantity_change) || quantity_change === 0) {
    return res.status(400).json({ error: 'quantity_change must be a non-zero integer (positive to add, negative to remove)' });
  }
  const product = getOwnedProduct(req, res);
  if (!product) return;

  const newStock = product.current_stock + quantity_change;
  if (newStock < 0) return res.status(400).json({ error: 'This adjustment would make stock negative' });

  db.prepare('UPDATE products SET current_stock = ? WHERE id = ?').run(newStock, req.params.id);
  logInventory(req.params.id, 'manual_adjustment', quantity_change, product.current_stock, newStock, note || '', req.user.id);
  logAudit('STOCK_ADJUSTED', 'product', req.params.id, req.user.id, { quantity_change, note }, req.user.warehouse_id);
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
});

module.exports = router;
