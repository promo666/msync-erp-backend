const jwt = require('jsonwebtoken');

// Supplier tokens carry { type: 'supplier' } so they can never be mistaken
// for a regular warehouse user token or a super-admin token.
function requireSupplier(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type !== 'supplier') {
      return res.status(403).json({ error: 'Supplier access required' });
    }
    req.supplier = payload; // { id, warehouse_id, name, type }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session, please log in again' });
  }
}

module.exports = { requireSupplier };
