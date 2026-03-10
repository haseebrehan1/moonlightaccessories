const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

const protect = async (req, res, next) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer '))
      return res.status(401).json({ success:false, message:'No token. Please log in.' });
    const decoded = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
    const { rows } = await query('SELECT id,full_name,email,phone,role FROM users WHERE id=$1', [decoded.id]);
    if (!rows.length) return res.status(401).json({ success:false, message:'User no longer exists.' });
    req.user = rows[0];
    next();
  } catch(err) {
    if (err.name === 'TokenExpiredError')
      return res.status(401).json({ success:false, message:'Token expired. Please log in again.' });
    return res.status(401).json({ success:false, message:'Invalid token.' });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const decoded = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
      const { rows } = await query('SELECT id,full_name,email,role FROM users WHERE id=$1', [decoded.id]);
      if (rows.length) req.user = rows[0];
    }
  } catch(_) {}
  next();
};

const restrictTo = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role))
    return res.status(403).json({ success:false, message:'Access denied. Insufficient permissions.' });
  next();
};

module.exports = { protect, optionalAuth, restrictTo };
