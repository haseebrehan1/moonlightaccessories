const { validationResult } = require('express-validator');
const { query, withTransaction } = require('../config/db');
const { sendOrderConfirmation } = require('../utils/email');

const FREE_SHIP = 5000;
const SHIP_FEE  = 200;

const genOrderNum = async (client) => {
  const { rows } = await client.query("SELECT nextval('order_seq') as s");
  const d = new Date().toISOString().slice(0,10).replace(/-/g,'');
  return `ML-${d}-${String(rows[0].s).padStart(4,'0')}`;
};

exports.createOrder = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success:false, errors:errors.array() });

  const { shipping_name, shipping_phone, shipping_email, shipping_address,
          shipping_city, shipping_notes, payment_method, items } = req.body;
  try {
    const result = await withTransaction(async (client) => {
      let subtotal = 0;
      const enriched = [];

      for (const item of items) {
        const { rows:vr } = await client.query(`
          SELECT pv.id, pv.product_id, pv.shade_key, pv.stock_qty,
                 p.name as product_name, p.price,
                 s.name as shade_name
          FROM product_variants pv
          JOIN products p ON p.id=pv.product_id
          JOIN shades s ON s.key=pv.shade_key
          WHERE pv.id=$1 AND pv.is_active=true AND p.is_active=true
        `, [item.variant_id]);

        if (!vr.length) throw Object.assign(new Error(`Variant ${item.variant_id} not found`), {statusCode:404});
        const v = vr[0];
        if (v.stock_qty < item.quantity)
          throw Object.assign(new Error(`"${v.product_name} - ${v.shade_name}" is out of stock`), {statusCode:409});

        const line_total = parseFloat(v.price) * item.quantity;
        subtotal += line_total;
        enriched.push({ ...v, quantity:item.quantity, line_total });
      }

      const shipping_fee = subtotal >= FREE_SHIP ? 0 : SHIP_FEE;
      const total = subtotal + shipping_fee;
      const order_number = await genOrderNum(client);

      const { rows:or } = await client.query(`
        INSERT INTO orders (order_number,user_id,status,payment_status,payment_method,
          shipping_name,shipping_phone,shipping_email,shipping_address,shipping_city,shipping_notes,
          subtotal,shipping_fee,discount,total)
        VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13) RETURNING *
      `, [order_number, req.user?.id||null,
          payment_method==='cod'?'cod_pending':'pending', payment_method,
          shipping_name, shipping_phone, shipping_email||null,
          shipping_address, shipping_city, shipping_notes||null,
          subtotal, shipping_fee, total]);

      const order = or[0];

      for (const item of enriched) {
        await client.query(
          'INSERT INTO order_items (order_id,product_id,variant_id,product_name,shade_name,shade_key,unit_price,quantity,line_total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [order.id, item.product_id, item.id, item.product_name, item.shade_name, item.shade_key, item.price, item.quantity, item.line_total]
        );
        await client.query('UPDATE product_variants SET stock_qty=stock_qty-$1 WHERE id=$2', [item.quantity, item.id]);
      }

      return { order, items:enriched };
    });

    if (shipping_email)
      sendOrderConfirmation(shipping_email, result.order, result.items).catch(console.error);

    res.status(201).json({
      success: true,
      message: 'Order placed successfully!',
      order: {
        id:             result.order.id,
        order_number:   result.order.order_number,
        status:         result.order.status,
        payment_method: result.order.payment_method,
        total:          result.order.total,
        shipping_fee:   result.order.shipping_fee,
        items: result.items.map(i => ({
          product_name: i.product_name, shade_name:i.shade_name,
          quantity:i.quantity, line_total:i.line_total,
        })),
      },
    });
  } catch(err) { next(err); }
};

exports.getMyOrders = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT o.id,o.order_number,o.status,o.payment_status,o.payment_method,o.total,o.created_at,
              count(oi.id) as item_count
       FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id
       WHERE o.user_id=$1 GROUP BY o.id ORDER BY o.created_at DESC`,
      [req.user.id]
    );
    res.json({ success:true, orders:rows });
  } catch(err) { next(err); }
};

exports.getOrder = async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success:false, message:'Order not found.' });
    const order = rows[0];
    if (req.user && order.user_id && order.user_id !== req.user.id && req.user.role==='customer')
      return res.status(403).json({ success:false, message:'Access denied.' });
    const { rows:items } = await query('SELECT * FROM order_items WHERE order_id=$1', [order.id]);
    res.json({ success:true, order:{ ...order, items } });
  } catch(err) { next(err); }
};

exports.cancelOrder = async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ success:false, message:'Order not found.' });
    if (!['pending','confirmed'].includes(rows[0].status))
      return res.status(400).json({ success:false, message:`Cannot cancel (status: ${rows[0].status}).` });

    await withTransaction(async (client) => {
      const { rows:items } = await client.query('SELECT * FROM order_items WHERE order_id=$1', [rows[0].id]);
      for (const item of items)
        await client.query('UPDATE product_variants SET stock_qty=stock_qty+$1 WHERE id=$2', [item.quantity, item.variant_id]);
      await client.query("UPDATE orders SET status='cancelled' WHERE id=$1", [rows[0].id]);
    });

    res.json({ success:true, message:'Order cancelled.' });
  } catch(err) { next(err); }
};
