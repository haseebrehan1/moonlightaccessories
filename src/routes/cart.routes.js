const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { query } = require('../config/db');

router.get('/', protect, async (req, res, next) => {
  try {
    const { rows:carts } = await query('SELECT id FROM carts WHERE user_id=$1', [req.user.id]);
    if (!carts.length) return res.json({ success:true, items:[], total:0, count:0 });
    const { rows } = await query(`
      SELECT ci.id, ci.quantity, pv.id as variant_id, pv.shade_key,
             s.name as shade_name, s.color_hex,
             p.id as product_id, p.name, p.slug, p.type, p.price,
             (p.price * ci.quantity) as line_total, pv.stock_qty
      FROM cart_items ci
      JOIN product_variants pv ON pv.id=ci.variant_id
      JOIN products p ON p.id=pv.product_id
      JOIN shades s ON s.key=pv.shade_key
      WHERE ci.cart_id=$1
    `, [carts[0].id]);
    const total = rows.reduce((s,i) => s + parseFloat(i.line_total), 0);
    res.json({ success:true, items:rows, total, count:rows.length });
  } catch(err) { next(err); }
});

router.post('/', protect, async (req, res, next) => {
  try {
    const { variant_id, quantity=1 } = req.body;
    if (!variant_id) return res.status(400).json({ success:false, message:'variant_id required' });
    let cartId;
    const { rows:ex } = await query('SELECT id FROM carts WHERE user_id=$1', [req.user.id]);
    if (ex.length) { cartId = ex[0].id; }
    else { const { rows } = await query('INSERT INTO carts (user_id) VALUES ($1) RETURNING id', [req.user.id]); cartId=rows[0].id; }
    await query(
      'INSERT INTO cart_items (cart_id,variant_id,quantity) VALUES ($1,$2,$3) ON CONFLICT (cart_id,variant_id) DO UPDATE SET quantity=cart_items.quantity+$3',
      [cartId, variant_id, quantity]
    );
    res.status(201).json({ success:true, message:'Added to cart.' });
  } catch(err) { next(err); }
});

router.put('/:id', protect, async (req, res, next) => {
  try {
    const { quantity } = req.body;
    if (quantity < 1) {
      await query('DELETE FROM cart_items WHERE id=$1', [req.params.id]);
      return res.json({ success:true, message:'Item removed.' });
    }
    await query('UPDATE cart_items SET quantity=$1 WHERE id=$2', [quantity, req.params.id]);
    res.json({ success:true, message:'Cart updated.' });
  } catch(err) { next(err); }
});

router.delete('/:id', protect, async (req, res, next) => {
  try {
    await query('DELETE FROM cart_items WHERE id=$1', [req.params.id]);
    res.json({ success:true, message:'Item removed.' });
  } catch(err) { next(err); }
});

router.delete('/', protect, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id FROM carts WHERE user_id=$1', [req.user.id]);
    if (rows.length) await query('DELETE FROM cart_items WHERE cart_id=$1', [rows[0].id]);
    res.json({ success:true, message:'Cart cleared.' });
  } catch(err) { next(err); }
});

module.exports = router;
