const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { protect } = require('../middleware/auth');
const { query } = require('../config/db');

router.get('/profile', protect, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id,full_name,email,phone,city,address,role,created_at FROM users WHERE id=$1', [req.user.id]
    );
    res.json({ success:true, user:rows[0] });
  } catch(err) { next(err); }
});

router.put('/profile', protect, async (req, res, next) => {
  try {
    const { full_name, phone, city, address } = req.body;
    const { rows } = await query(
      'UPDATE users SET full_name=COALESCE($1,full_name),phone=COALESCE($2,phone),city=COALESCE($3,city),address=COALESCE($4,address) WHERE id=$5 RETURNING id,full_name,email,phone,city,address',
      [full_name, phone, city, address, req.user.id]
    );
    res.json({ success:true, user:rows[0] });
  } catch(err) { next(err); }
});

router.put('/password', protect, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password)
      return res.status(400).json({ success:false, message:'Both passwords required.' });
    const { rows } = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    if (!await bcrypt.compare(current_password, rows[0].password_hash))
      return res.status(401).json({ success:false, message:'Current password incorrect.' });
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(new_password, 12), req.user.id]);
    res.json({ success:true, message:'Password updated.' });
  } catch(err) { next(err); }
});

router.get('/orders', protect, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT o.id,o.order_number,o.status,o.payment_status,o.total,o.created_at,count(oi.id) as item_count FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id WHERE o.user_id=$1 GROUP BY o.id ORDER BY o.created_at DESC',
      [req.user.id]
    );
    res.json({ success:true, orders:rows });
  } catch(err) { next(err); }
});

module.exports = router;
