const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit, logInventory, genId } = require('../helpers');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('owner', 'admin'));

router.get('/', (req, res) => {
  const orders = db.prepare(
    `SELECT po.*, s.name AS supplier_name
     FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.warehouse_id = ? ORDER BY po.created_at DESC`
  ).all(req.user.warehouse_id);

  const itemsStmt = db.prepare(
    `SELECT poi.*, p.name AS product_name, p.sku FROM purchase_order_items poi JOIN products p ON p.id = poi.product_id WHERE poi.po_id = ?`
  );
  res.json(orders.map(po => ({ ...po, items: itemsStmt.all(po.id) })));
});

router.get('/:id', (req, res) => {
  const po = db.prepare(
    `SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?`
  ).get(req.params.id);
  if (!po || po.warehouse_id !== req.user.warehouse_id) return res.status(404).json({ error: 'Purchase order not found' });

  const items = db.prepare(
    `SELECT poi.*, p.name AS product_name, p.sku FROM purchase_order_items poi JOIN products p ON p.id = poi.product_id WHERE poi.po_id = ?`
  ).all(po.id);
  res.json({ ...po, items });
});

// Create a new purchase order (status: pending — stock is NOT added yet, only
// when it's marked "received", since that's when goods actually arrive).
router.post('/', (req, res) => {
  const { supplier_id, items, notes } = req.body;
  if (!supplier_id) return res.status(400).json({ error: 'supplier_id is required' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one item is required' });

  const warehouseId = req.user.warehouse_id;
  const supplier = db.prepare('SELECT id FROM suppliers WHERE id = ? AND warehouse_id = ?').get(supplier_id, warehouseId);
  if (!supplier) return res.status(400).json({ error: 'Supplier not found' });

  const getProduct = db.prepare('SELECT * FROM products WHERE id = ? AND warehouse_id = ?');
  const insertPO = db.prepare(
    `INSERT INTO purchase_orders (id, warehouse_id, supplier_id, order_number, status, total_amount, notes, created_by) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO purchase_order_items (po_id, product_id, quantity, unit_cost, subtotal) VALUES (?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    const poId = genId('po');
    const orderNumber = 'PO-' + Date.now().toString().slice(-8) + '-' + Math.floor(Math.random() * 90 + 10);

    // Insert the PO first (with a placeholder total), since items reference it.
    insertPO.run(poId, warehouseId, supplier_id, orderNumber, 0, notes || '', req.user.id);

    let total = 0;
    for (const item of items) {
      const product = getProduct.get(item.product_id, warehouseId);
      if (!product) throw new Error(`Product not found: ${item.product_id}`);
      const qty = parseInt(item.quantity, 10);
      const unitCost = parseFloat(item.unit_cost);
      if (!Number.isInteger(qty) || qty <= 0) throw new Error(`Invalid quantity for ${product.name}`);
      if (Number.isNaN(unitCost) || unitCost < 0) throw new Error(`Invalid unit cost for ${product.name}`);

      const subtotal = qty * unitCost;
      total += subtotal;
      insertItem.run(poId, product.id, qty, unitCost, subtotal);
    }

    db.prepare('UPDATE purchase_orders SET total_amount = ? WHERE id = ?').run(total, poId);
    return { poId, orderNumber, total };
  });

  try {
    const { poId, orderNumber, total } = tx();
    logAudit('PO_CREATED', 'purchase_order', poId, req.user.id, { order_number: orderNumber, total }, warehouseId);
    const po = db.prepare(
      `SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?`
    ).get(poId);
    const poItems = db.prepare(
      `SELECT poi.*, p.name AS product_name, p.sku FROM purchase_order_items poi JOIN products p ON p.id = poi.product_id WHERE poi.po_id = ?`
    ).all(poId);
    res.status(201).json({ ...po, items: poItems });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Mark a purchase order as received: adds the ordered quantities to stock,
// and updates each product's cost_price to the latest cost paid (so profit
// margin reports stay accurate going forward).
router.post('/:id/receive', (req, res) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po || po.warehouse_id !== req.user.warehouse_id) return res.status(404).json({ error: 'Purchase order not found' });
  if (po.status !== 'pending') return res.status(400).json({ error: `This order is already ${po.status}` });

  const items = db.prepare('SELECT * FROM purchase_order_items WHERE po_id = ?').all(po.id);
  const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
  const updateStock = db.prepare('UPDATE products SET current_stock = ?, cost_price = ? WHERE id = ?');

  const tx = db.transaction(() => {
    for (const item of items) {
      const product = getProduct.get(item.product_id);
      const newStock = product.current_stock + item.quantity;
      updateStock.run(newStock, item.unit_cost, product.id);
      logInventory(product.id, 'purchase_order_received', item.quantity, product.current_stock, newStock, `PO ${po.order_number}`, req.user.id);
    }
    db.prepare(`UPDATE purchase_orders SET status = 'received', received_at = datetime('now') WHERE id = ?`).run(po.id);
  });
  tx();

  logAudit('PO_RECEIVED', 'purchase_order', po.id, req.user.id, { order_number: po.order_number }, req.user.warehouse_id);
  res.json({ ok: true });
});

router.post('/:id/cancel', (req, res) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po || po.warehouse_id !== req.user.warehouse_id) return res.status(404).json({ error: 'Purchase order not found' });
  if (po.status !== 'pending') return res.status(400).json({ error: `This order is already ${po.status}` });

  db.prepare(`UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?`).run(po.id);
  logAudit('PO_CANCELLED', 'purchase_order', po.id, req.user.id, { order_number: po.order_number }, req.user.warehouse_id);
  res.json({ ok: true });
});

module.exports = router;
