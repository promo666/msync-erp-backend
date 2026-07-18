const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit, logInventory, genId } = require('../helpers');

const router = express.Router();
router.use(requireAuth);

// Salesmen only see their own sales; owner/admin see everyone's IN THEIR OWN WAREHOUSE
router.get('/', (req, res) => {
  const isManager = req.user.role === 'owner' || req.user.role === 'admin' || req.user.role === 'sales_supervisor';
  const baseSelect = `SELECT s.*, u.full_name AS salesman_name, sh.name AS shop_name, sh.location AS shop_location,
                              sh.latitude AS shop_latitude, sh.longitude AS shop_longitude,
                              c.name AS linked_customer_name
                       FROM sales s
                       JOIN users u ON u.id = s.salesman_id
                       LEFT JOIN shops sh ON sh.id = s.shop_id
                       LEFT JOIN customers c ON c.id = s.customer_id`;
  const sales = isManager
    ? db.prepare(`${baseSelect} WHERE s.warehouse_id = ? ORDER BY s.created_at DESC`).all(req.user.warehouse_id)
    : db.prepare(`${baseSelect} WHERE s.warehouse_id = ? AND s.salesman_id = ? ORDER BY s.created_at DESC`).all(req.user.warehouse_id, req.user.id);

  const itemsStmt = db.prepare(
    `SELECT si.*, p.name AS product_name, p.sku FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ?`
  );
  const result = sales.map(s => ({ ...s, items: itemsStmt.all(s.id) }));
  res.json(result);
});

// Create a sale — atomic transaction, scoped entirely to the salesman's warehouse.
// Products from another warehouse can never be sold here, since we look them
// up by (id, warehouse_id) together.
router.post('/', (req, res) => {
  const { customer_name, customer_phone, items, shop_id, customer_id, payment_method, coupon_code } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required' });
  }

  const warehouseId = req.user.warehouse_id;
  const method = payment_method === 'credit' ? 'credit' : 'cash';

  // If a shop was selected, make sure it actually belongs to this warehouse
  let selectedShop = null;
  if (shop_id) {
    selectedShop = db.prepare('SELECT * FROM shops WHERE id = ? AND warehouse_id = ?').get(shop_id, warehouseId);
    if (!selectedShop) return res.status(400).json({ error: 'Selected shop was not found' });
  }
  const validShopId = selectedShop ? selectedShop.id : null;

  // If a customer was selected, make sure it belongs to this warehouse.
  // Credit sales REQUIRE a customer, since credit is tracked per-customer.
  let customer = null;
  if (customer_id) {
    customer = db.prepare('SELECT * FROM customers WHERE id = ? AND warehouse_id = ?').get(customer_id, warehouseId);
    if (!customer) return res.status(400).json({ error: 'Selected customer was not found' });
  }
  if (method === 'credit' && !customer && !selectedShop) {
    return res.status(400).json({ error: 'A shop or customer must be selected for credit sales' });
  }

  const getProduct = db.prepare('SELECT * FROM products WHERE id = ? AND warehouse_id = ?');
  const updateStock = db.prepare('UPDATE products SET current_stock = ? WHERE id = ?');
  const insertSale = db.prepare(
    `INSERT INTO sales (id, warehouse_id, shop_id, customer_id, payment_method, invoice_number, salesman_id, customer_name, customer_phone, total_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')`
  );
  const insertItem = db.prepare(
    `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)`
  );

  const runSaleTransaction = db.transaction((items) => {
    let total = 0;
    const lineItems = [];
    const saleId = genId('sale');
    const invoiceNumber = 'INV-' + Date.now().toString().slice(-8) + '-' + Math.floor(Math.random() * 90 + 10);

    // Create the sale row FIRST (even with a placeholder total of 0), since
    // sale_items has a foreign key that requires the sale to already exist.
    // We update the real total at the end once every item is processed.
    insertSale.run(
      saleId, warehouseId, validShopId, customer ? customer.id : null, method, invoiceNumber, req.user.id,
      customer_name || (customer ? customer.name : ''), customer_phone || (customer ? customer.phone : ''), 0
    );

    for (const item of items) {
      const product = getProduct.get(item.product_id, warehouseId);
      if (!product || !product.is_active) throw new Error(`Product not found or inactive: ${item.product_id}`);
      const qty = parseInt(item.quantity, 10);
      if (!Number.isInteger(qty) || qty <= 0) throw new Error(`Invalid quantity for ${product.name}`);
      if (product.current_stock < qty) throw new Error(`Not enough stock for ${product.name} (only ${product.current_stock} left)`);

      const newStock = product.current_stock - qty;
      updateStock.run(newStock, product.id);
      logInventory(product.id, 'sale', -qty, product.current_stock, newStock, `Sale ${invoiceNumber}`, req.user.id);

      const subtotal = qty * product.unit_price;
      total += subtotal;
      lineItems.push({ product_id: product.id, quantity: qty, unit_price: product.unit_price });
      insertItem.run(saleId, product.id, qty, product.unit_price, subtotal);
    }

    // Apply coupon discount server-side (never trust a discount amount sent
    // from the browser — always re-check and re-calculate here).
    let discountAmount = 0;
    let appliedCouponCode = null;
    if (coupon_code) {
      const coupon = db.prepare('SELECT * FROM coupons WHERE warehouse_id = ? AND code = ?').get(warehouseId, String(coupon_code).trim().toUpperCase());
      if (!coupon || !coupon.is_active) throw new Error('Coupon not found or inactive');
      if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) throw new Error('This coupon has expired');
      if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses) throw new Error('This coupon has reached its usage limit');

      if (coupon.type === 'bogo') {
        const matching = lineItems.find(i => i.product_id === coupon.applies_to_product_id);
        if (!matching) throw new Error('The product required for this offer is not in the cart');
        const bundleSize = coupon.buy_qty + coupon.free_qty;
        const sets = Math.floor(matching.quantity / bundleSize);
        if (sets === 0) throw new Error(`Add at least ${bundleSize} of the required product to use this offer`);
        discountAmount = sets * coupon.free_qty * matching.unit_price;
      } else {
        if (total < coupon.min_purchase) throw new Error(`Minimum purchase of ${coupon.min_purchase} required for this coupon`);
        discountAmount = coupon.type === 'percent' ? total * (coupon.value / 100) : Math.min(coupon.value, total);
      }

      appliedCouponCode = coupon.code;
      db.prepare('UPDATE coupons SET uses_count = uses_count + 1 WHERE id = ?').run(coupon.id);
    }

    const finalTotal = total - discountAmount;
    db.prepare('UPDATE sales SET total_amount = ?, discount_amount = ?, coupon_code = ? WHERE id = ?').run(finalTotal, discountAmount, appliedCouponCode, saleId);
    total = finalTotal;

    if (method === 'credit' && selectedShop) {
      const newShopBalance = selectedShop.credit_balance + total;
      db.prepare('UPDATE shops SET credit_balance = ?, last_credit_at = datetime(\'now\') WHERE id = ?').run(newShopBalance, selectedShop.id);
    } else if (method === 'credit' && customer) {
      const newBalance = customer.credit_balance + total;
      if (customer.credit_limit > 0 && newBalance > customer.credit_limit) {
        throw new Error(`This sale would exceed ${customer.name}'s credit limit (${customer.credit_limit}). Current balance: ${customer.credit_balance}.`);
      }
      db.prepare('UPDATE customers SET credit_balance = ? WHERE id = ?').run(newBalance, customer.id);
    }

    return { saleId, invoiceNumber, total };
  });

  try {
    const { saleId, invoiceNumber, total } = runSaleTransaction(items);
    logAudit('SALE_CREATED', 'sale', saleId, req.user.id, { invoice_number: invoiceNumber, total }, warehouseId);

    const sale = db.prepare(
      `SELECT s.*, sh.name AS shop_name, sh.location AS shop_location, sh.latitude AS shop_latitude, sh.longitude AS shop_longitude,
              c.name AS linked_customer_name
       FROM sales s LEFT JOIN shops sh ON sh.id = s.shop_id LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`
    ).get(saleId);
    const saleItems = db.prepare(
      `SELECT si.*, p.name AS product_name, p.sku FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ?`
    ).all(saleId);

    res.status(201).json({ ...sale, items: saleItems });
  } catch (err) {
    // Transaction was rolled back automatically by better-sqlite3 on throw
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/void', requireRole('owner', 'admin'), (req, res) => {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!sale || sale.warehouse_id !== req.user.warehouse_id) return res.status(404).json({ error: 'Sale not found' });
  if (sale.status === 'voided') return res.status(400).json({ error: 'Sale is already voided' });

  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(req.params.id);
  const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
  const updateStock = db.prepare('UPDATE products SET current_stock = ? WHERE id = ?');

  const voidTx = db.transaction(() => {
    for (const item of items) {
      const product = getProduct.get(item.product_id);
      const newStock = product.current_stock + item.quantity;
      updateStock.run(newStock, product.id);
      logInventory(product.id, 'sale_voided', item.quantity, product.current_stock, newStock, `Void of sale ${sale.invoice_number}`, req.user.id);
    }
    db.prepare(`UPDATE sales SET status = 'voided' WHERE id = ?`).run(req.params.id);
  });
  voidTx();

  logAudit('SALE_VOIDED', 'sale', req.params.id, req.user.id, { invoice_number: sale.invoice_number }, req.user.warehouse_id);
  res.json({ ok: true });
});

module.exports = router;
