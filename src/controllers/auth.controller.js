const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const { query } = require('../config/db');

const signToken   = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
const signRefresh = id => jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' });

const sendTokens = (res, user, status=200) => {
  const token   = signToken(user.id);
  const refresh = signRefresh(user.id);
  query('UPDATE users SET refresh_token=$1 WHERE id=$2', [refresh, user.id]);
  const { password_hash, refresh_token, ...safe } = user;
  res.status(status).json({ success:true, token, refresh_token:refresh, user:safe });
};

exports.register = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ success:false, errors:errors.array() });
    const { full_name, email, password, phone } = req.body;
    const { rows:ex } = await query('SELECT id FROM users WHERE email=$1', [email]);
    if (ex.length) return res.status(409).json({ success:false, message:'Email already registered.' });
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      "INSERT INTO users (full_name,email,phone,password_hash,role,is_verified) VALUES ($1,$2,$3,$4,'customer',true) RETURNING *",
      [full_name, email, phone||null, hash]
    );
    sendTokens(res, rows[0], 201);
  } catch(err) { next(err); }
};

exports.login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ success:false, errors:errors.array() });
    const { email, password } = req.body;
    const { rows } = await query('SELECT * FROM users WHERE email=$1', [email]);
    if (!rows.length || !await bcrypt.compare(password, rows[0].password_hash))
      return res.status(401).json({ success:false, message:'Invalid email or password.' });
    sendTokens(res, rows[0]);
  } catch(err) { next(err); }
};

exports.logout = async (req, res, next) => {
  try {
    await query('UPDATE users SET refresh_token=NULL WHERE id=$1', [req.user.id]);
    res.json({ success:true, message:'Logged out.' });
  } catch(err) { next(err); }
};

exports.refreshToken = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(401).json({ success:false, message:'Refresh token required.' });
    const decoded = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);
    const { rows } = await query('SELECT * FROM users WHERE id=$1 AND refresh_token=$2', [decoded.id, refresh_token]);
    if (!rows.length) return res.status(401).json({ success:false, message:'Invalid refresh token.' });
    sendTokens(res, rows[0]);
  } catch(err) {
    if (err.name === 'TokenExpiredError')
      return res.status(401).json({ success:false, message:'Refresh token expired. Please log in again.' });
    next(err);
  }
};

exports.getMe = async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id,full_name,email,phone,role,city,address,created_at FROM users WHERE id=$1', [req.user.id]
    );
    res.json({ success:true, user:rows[0] });
  } catch(err) { next(err); }
};
