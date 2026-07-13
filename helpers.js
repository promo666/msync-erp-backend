const db = require('./db');

function logAudit(action, entityType, entityId, userId, details, warehouseId) {
  db.prepare(
    `INSERT INTO audit_logs (warehouse_id, action, entity_type, entity_id, user_id, details) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(warehouseId || null, action, entityType || null, entityId || null, userId || null, details ? JSON.stringify(details) : null);
}

function logInventory(productId, changeType, quantityChange, previousStock, newStock, note, userId) {
  db.prepare(
    `INSERT INTO inventory_logs (product_id, change_type, quantity_change, previous_stock, new_stock, note, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(productId, changeType, quantityChange, previousStock, newStock, note || null, userId || null);
}

function genId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = { logAudit, logInventory, genId };
