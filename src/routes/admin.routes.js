const router = require('express').Router();
const { protect, restrictTo } = require('../middleware/auth');
const { query } = require('../config/db');

router.use(protect, restrictTo('admin','superadmin'));

// Dashboard
router.get('/dashboard', async (req, res, next) => {
  try {
    const [orders, revenue, products, customers, recent, top] = await Promise.all([
      query('SELECT status, COUNT(*) as count FROM orders GROUP BY status'),
      query("SELECT COALESCE(SUM(total),0) as total, COALESCE(SUM(CASE WHEN created_at>=date_trunc('month',NOW()) THEN total ELSE 0 END),0) as month FROM orders WHERE status NOT IN ('cancelled','refunded')"),
      query("SELECT COUNT(*) as count FROM products WHERE is_active=true"),
      query("SELECT COUNT(*) as count FROM users WHERE role='customer'"),
      query("SELECT o.id,o.order_number,o.status,o.payment_method,o.total,o.shipping_name,o.shipping_city,o.created_at FROM orders o ORDER BY o.created_at DESC LIMIT 10"),
      query("SELECT p.name,SUM(oi.quantity) as sold,SUM(oi.line_total) as revenue FROM order_items oi JOIN products p ON p.id=oi.product_id GROUP BY p.id ORDER BY sold DESC LIMIT 5"),
    ]);
    const byStatus = {};
    orders.rows.forEach(r => byStatus[r.status] = parseInt(r.count));
    res.json({
      success:true,
      stats: {
        orders: byStatus,
        total_orders: Object.values(byStatus).reduce((a,b)=>a+b, 0),
        revenue: { total: parseFloat(revenue.rows[0].total), monthly: parseFloat(revenue.rows[0].month) },
        products: parseInt(products.rows[0].count),
        customers: parseInt(customers.rows[0].count),
      },
      recent_orders: recent.rows,
      top_products: top.rows,
    });
  } catch(err) { next(err); }
});

// Orders
router.get('/orders', async (req, res, next) => {
  try {
    const { status, page=1, limit=20 } = req.query;
    const offset = (page-1)*limit;
    const params = [parseInt(limit), parseInt(offset)];
    let where = '';
    if (status) { params.push(status); where = `WHERE o.status=$${params.length}`; }
    const { rows } = await query(
      `SELECT o.*,count(oi.id) as item_count FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id ${where} GROUP BY o.id ORDER BY o.created_at DESC LIMIT $1 OFFSET $2`,
      params
    );
    const { rows:total } = await query(`SELECT COUNT(*) FROM orders ${where}`, status?[status]:[]);
    res.json({ success:true, orders:rows, total:parseInt(total[0].count), page:parseInt(page) });
  } catch(err) { next(err); }
});

router.get('/orders/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success:false, message:'Order not found.' });
    const { rows:items } = await query('SELECT * FROM order_items WHERE order_id=$1', [req.params.id]);
    res.json({ success:true, order:{ ...rows[0], items } });
  } catch(err) { next(err); }
});

router.put('/orders/:id/status', async (req, res, next) => {
  try {
    const { status, tracking_number } = req.body;
    const valid = ['pending','confirmed','processing','shipped','delivered','cancelled','refunded'];
    if (!valid.includes(status)) return res.status(400).json({ success:false, message:'Invalid status.' });
    const { rows } = await query(
      'UPDATE orders SET status=$1,tracking_number=COALESCE($2,tracking_number) WHERE id=$3 RETURNING *',
      [status, tracking_number||null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success:false, message:'Not found.' });
    res.json({ success:true, order:rows[0] });
  } catch(err) { next(err); }
});

// Products
router.get('/products', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT p.*,count(pv.id) as variant_count FROM products p LEFT JOIN product_variants pv ON pv.product_id=p.id GROUP BY p.id ORDER BY p.sort_order,p.created_at DESC'
    );
    res.json({ success:true, products:rows });
  } catch(err) { next(err); }
});

router.post('/products', async (req, res, next) => {
  try {
    const { slug,name,description,category,type,badge,price,is_featured,features,variants } = req.body;
    const { rows } = await query(
      'INSERT INTO products (slug,name,description,category,type,badge,price,is_featured) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [slug,name,description,category,type,badge,price,is_featured||false]
    );
    const pid = rows[0].id;
    if (features?.length)
      for (let i=0;i<features.length;i++)
        await query('INSERT INTO product_features (product_id,feature,sort_order) VALUES ($1,$2,$3)', [pid,features[i],i]);
    if (variants?.length)
      for (const v of variants) {
        const sku = `ML-${slug.replace(/-/g,'').substring(0,8).toUpperCase()}-${v.shade_key.toUpperCase()}`;
        await query('INSERT INTO product_variants (product_id,shade_key,sku,stock_qty) VALUES ($1,$2,$3,$4)', [pid,v.shade_key,sku,v.stock_qty||100]);
      }
    res.status(201).json({ success:true, product:rows[0] });
  } catch(err) { next(err); }
});

router.put('/products/:id', async (req, res, next) => {
  try {
    const { name,description,badge,price,compare_price,is_featured,is_active } = req.body;
    const { rows } = await query(
      'UPDATE products SET name=COALESCE($1,name),description=COALESCE($2,description),badge=COALESCE($3,badge),price=COALESCE($4,price),compare_price=COALESCE($5,compare_price),is_featured=COALESCE($6,is_featured),is_active=COALESCE($7,is_active) WHERE id=$8 RETURNING *',
      [name,description,badge,price,compare_price,is_featured,is_active,req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success:false, message:'Not found.' });
    res.json({ success:true, product:rows[0] });
  } catch(err) { next(err); }
});

router.put('/variants/:id/stock', async (req, res, next) => {
  try {
    const { rows } = await query('UPDATE product_variants SET stock_qty=$1 WHERE id=$2 RETURNING *', [req.body.stock_qty, req.params.id]);
    res.json({ success:true, variant:rows[0] });
  } catch(err) { next(err); }
});

router.delete('/products/:id', async (req, res, next) => {
  try {
    await query('UPDATE products SET is_active=false WHERE id=$1', [req.params.id]);
    res.json({ success:true, message:'Product deactivated.' });
  } catch(err) { next(err); }
});

// Customers
router.get('/customers', async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT u.id,u.full_name,u.email,u.phone,u.city,u.created_at,count(o.id) as order_count,COALESCE(sum(o.total),0) as total_spent FROM users u LEFT JOIN orders o ON o.user_id=u.id AND o.status!='cancelled' WHERE u.role='customer' GROUP BY u.id ORDER BY u.created_at DESC"
    );
    res.json({ success:true, customers:rows });
  } catch(err) { next(err); }
});

// Reviews
router.get('/reviews', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT r.*,p.name as product_name FROM reviews r LEFT JOIN products p ON p.id=r.product_id ORDER BY r.created_at DESC LIMIT 50'
    );
    res.json({ success:true, reviews:rows });
  } catch(err) { next(err); }
});

router.put('/reviews/:id/approve', async (req, res, next) => {
  try {
    await query('UPDATE reviews SET is_approved=true WHERE id=$1', [req.params.id]);
    res.json({ success:true, message:'Review approved.' });
  } catch(err) { next(err); }
});

router.delete('/reviews/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM reviews WHERE id=$1', [req.params.id]);
    res.json({ success:true, message:'Review deleted.' });
  } catch(err) { next(err); }
});

module.exports = router;
