const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logAudit, genId } = require('../helpers');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' }
});

router.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const candidates = db.prepare(
    `SELECT u.*, w.is_active AS warehouse_active, w.name AS warehouse_name
     FROM users u JOIN warehouses w ON w.id = u.warehouse_id
     WHERE u.email = ?`
  ).all(String(email).toLowerCase().trim());

  let matchedUser = null;
  for (const user of candidates) {
    if (user.is_active && user.warehouse_active && bcrypt.compareSync(password, user.password_hash)) {
      matchedUser = user;
      break;
    }
  }

  if (!matchedUser) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign(
    {
      id: matchedUser.id,
      email: matchedUser.email,
      role: matchedUser.role,
      full_name: matchedUser.full_name,
      warehouse_id: matchedUser.warehouse_id
    },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  logAudit('LOGIN', 'user', matchedUser.id, matchedUser.id, { role: matchedUser.role }, matchedUser.warehouse_id);

  res.json({
    token,
    user: {
      id: matchedUser.id,
      email: matchedUser.email,
      full_name: matchedUser.full_name,
      role: matchedUser.role,
      warehouse_id: matchedUser.warehouse_id,
      warehouse_name: matchedUser.warehouse_name,
      must_change_password: !!matchedUser.must_change_password
    }
  });
});

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
router.post('/register-warehouse', registerLimiter, (req, res) => {
  const { warehouse_name, owner_name, email, password } = req.body;
  if (!warehouse_name || !owner_name || !email || !password) {
    return res.status(400).json({ error: 'warehouse_name, owner_name, email and password are all required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  const createWarehouseAndOwner = db.transaction(() => {
    const warehouseId = genId('wh');
    db.prepare('INSERT INTO warehouses (id, name) VALUES (?, ?)').run(warehouseId, warehouse_name);

    const userId = genId('user');
    const hash = bcrypt.hashSync(password, 12);
    db.prepare(
      `INSERT INTO users (id, warehouse_id, email, password_hash, full_name, role, is_active, must_change_password)
       VALUES (?, ?, ?, ?, ?, 'owner', 1, 0)`
    ).run(userId, warehouseId, normalizedEmail, hash, owner_name);

    return { warehouseId, userId };
  });

  try {
    const { warehouseId, userId } = createWarehouseAndOwner();
    logAudit('WAREHOUSE_REGISTERED', 'warehouse', warehouseId, userId, { warehouse_name }, warehouseId);

    const token = jwt.sign(
      { id: userId, email: normalizedEmail, role: 'owner', full_name: owner_name, warehouse_id: warehouseId },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.status(201).json({
      token,
      user: {
        id: userId,
        email: normalizedEmail,
        full_name: owner_name,
        role: 'owner',
        warehouse_id: warehouseId,
        warehouse_name,
        must_change_password: false
      }
    });
  } catch (err) {
    res.status(400).json({ error: 'Could not create warehouse. Please try again.' });
  }
});

router.post('/logout', requireAuth, (req, res) => {
  logAudit('LOGOUT', 'user', req.user.id, req.user.id, null, req.user.warehouse_id);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, full_name, role, is_active, warehouse_id FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const hash = bcrypt.hashSync(new_password, 12);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, user.id);
  logAudit('PASSWORD_CHANGED', 'user', user.id, user.id, null, req.user.warehouse_id);
  res.json({ ok: true });
});

module.exports = router;