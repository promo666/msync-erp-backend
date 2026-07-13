const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit, genId } = require('../helpers');

const router = express.Router();
router.use(requireAuth);

// Accepts either:
//  - a single pasted "coordinates" string like "25.276987, 51.520008" (what
//    Google Maps gives you when you right-click a location and copy it), or
//  - separate latitude/longitude fields directly.
// Returns { latitude, longitude } (numbers) or { latitude: null, longitude: null }.
function parseCoordinates({ coordinates, latitude, longitude }) {
  if (coordinates && typeof coordinates === 'string') {
    const parts = coordinates.split(',').map(s => s.trim());
    if (parts.length === 2) {
      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);
      if (!Number.isNaN(lat) && !Number.isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { latitude: lat, longitude: lng };
      }
    }
    return { error: 'Could not read those coordinates. Paste them as "latitude, longitude", e.g. 25.276987, 51.520008' };
  }
  if (latitude != null && longitude != null) {
    return { latitude: parseFloat(latitude), longitude: parseFloat(longitude) };
  }
  return { latitude: null, longitude: null };
}

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM shops WHERE warehouse_id = ? ORDER BY name ASC').all(req.user.warehouse_id));
});

router.post('/', requireRole('owner', 'admin'), (req, res) => {
  const { name, owner_name, phone, location } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const coords = parseCoordinates(req.body);
  if (coords.error) return res.status(400).json({ error: coords.error });

  const id = genId('shop');
  db.prepare('INSERT INTO shops (id, warehouse_id, name, owner_name, phone, location, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.user.warehouse_id, name, owner_name || '', phone || '', location || '', coords.latitude, coords.longitude);
  logAudit('SHOP_CREATED', 'shop', id, req.user.id, { name }, req.user.warehouse_id);
  res.status(201).json(db.prepare('SELECT * FROM shops WHERE id = ?').get(id));
});

router.put('/:id', requireRole('owner', 'admin'), (req, res) => {
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.params.id);
  if (!shop || shop.warehouse_id !== req.user.warehouse_id) return res.status(404).json({ error: 'Shop not found' });
  const { name, owner_name, phone, location, is_active } = req.body;

  const hasCoordInput = req.body.coordinates != null || req.body.latitude != null || req.body.longitude != null;
  let newLat = shop.latitude;
  let newLng = shop.longitude;
  if (hasCoordInput) {
    const coords = parseCoordinates(req.body);
    if (coords.error) return res.status(400).json({ error: coords.error });
    newLat = coords.latitude;
    newLng = coords.longitude;
  }

  db.prepare('UPDATE shops SET name=?, owner_name=?, phone=?, location=?, latitude=?, longitude=?, is_active=? WHERE id=?')
    .run(
      name ?? shop.name,
      owner_name ?? shop.owner_name,
      phone ?? shop.phone,
      location ?? shop.location,
      newLat,
      newLng,
      is_active === undefined ? shop.is_active : (is_active ? 1 : 0),
      req.params.id
    );
  logAudit('SHOP_UPDATED', 'shop', req.params.id, req.user.id, null, req.user.warehouse_id);
  res.json(db.prepare('SELECT * FROM shops WHERE id = ?').get(req.params.id));
});

// Record a payment against a shop's outstanding credit balance
router.post('/:id/payments', requireRole('owner', 'admin'), (req, res) => {
  const { amount, note } = req.body;
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.params.id);
  if (!shop || shop.warehouse_id !== req.user.warehouse_id) return res.status(404).json({ error: 'Shop not found' });

  const amt = parseFloat(amount);
  if (Number.isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Enter a valid payment amount' });

  const tx = db.transaction(() => {
    db.prepare('INSERT INTO shop_payments (shop_id, amount, note, user_id) VALUES (?, ?, ?, ?)').run(req.params.id, amt, note || '', req.user.id);
    const newBalance = Math.max(0, shop.credit_balance - amt);
    db.prepare('UPDATE shops SET credit_balance = ? WHERE id = ?').run(newBalance, req.params.id);
    return newBalance;
  });
  const newBalance = tx();

  logAudit('SHOP_PAYMENT', 'shop', req.params.id, req.user.id, { amount: amt }, req.user.warehouse_id);
  res.json({ ok: true, new_balance: newBalance });
});

module.exports = router;
