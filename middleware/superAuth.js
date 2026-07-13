const jwt = require('jsonwebtoken');

// Super-admin tokens are signed with the same JWT_SECRET but carry
// { type: 'superadmin' } so they can never be mistaken for, or reused as,
// a regular warehouse user token (and vice versa).
function requireSuperAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type !== 'superadmin') {
      return res.status(403).json({ error: 'Super admin access required' });
    }
    req.superAdmin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session, please log in again' });
  }
}

module.exports = { requireSuperAdmin };
