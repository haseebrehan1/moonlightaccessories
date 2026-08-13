const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');
const { protect, restrictTo } = require('../middleware/auth');
const { query, withTransaction } = require('../config/db');

// product_variants.shade_key is a foreign key into shades(key). A key that
// isn't there is bad input, not a server fault — say so, and say where the
// real ones live, rather than surfacing a raw constraint error as a 500.
const isUnknownShade = err => err.code === '23503' && /shade_key/.test(err.constraint || '');
const unknownShadeMsg = 'Unknown shade. Valid shades come from GET /api/v1/products/shades.';
const isDuplicateSlug = err => err.code === '23505' && /slug/.test(err.constraint || '');

// product_variants.sku is UNIQUE. Building it from the first 8 characters of
// the slug made every product that starts the same way ("straight-…") collide
// on any shade they share, failing the save. products.slug is itself unique,
// so the whole slug keeps the SKU unique; the column is VARCHAR(80), and on
// the rare slug long enough to need cutting a short digest of it stands in.
const digest = s => Math.abs([...s].reduce((h,c) => (h*31 + c.charCodeAt(0))|0, 7)).toString(36).slice(0,4).toUpperCase();
const skuFor = (slug, shadeKey) => {
  const base  = slug.replace(/[^a-z0-9]/gi,'').toUpperCase();
  const shade = shadeKey.toUpperCase();
  const room  = 76 - shade.length;
  return `ML-${base.length <= room ? base : base.slice(0, room-4) + digest(slug)}-${shade}`;
};

router.use(protect, restrictTo('admin','superadmin'));

// Dashboard
router.get('/dashboard', async (req, res, next) => {
  try {
    const [orders, revenue, products, customers, recent, top] = await Promise.all([
      query('SELECT status, COUNT(*) as count FROM orders GROUP BY status'),
      query("SELECT COALESCE(SUM(total),0) as total, COALESCE(SUM(CASE WHEN created_at>=date_trunc('month',NOW()) THEN total ELSE 0 END),0) as month FROM orders WHERE status NOT IN ('cancelled','refunded')"),
      query("SELECT COUNT(*) as count FROM products WHERE is_active=true"),
      // Counted the same way the Customers page lists them — by the people who
      // have actually ordered. Counting user rows read zero, because checkout
      // is guest-only and nobody registers.
      query('SELECT COUNT(DISTINCT shipping_phone) as count FROM orders WHERE shipping_phone IS NOT NULL'),
      query("SELECT o.id,o.order_number,o.status,o.payment_method,o.total,o.shipping_name,o.shipping_phone,o.shipping_city,o.created_at FROM orders o ORDER BY o.created_at DESC LIMIT 10"),
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

// Live visitors. "Active now" means seen within the last 5 minutes, which
// covers a browser that has gone a minute without sending its heartbeat.
// Days are counted in Pakistan time, not the server's UTC.
router.get('/live', async (req, res, next) => {
  try {
    const since = req.query.range === '7d'
      ? "NOW() - INTERVAL '7 days'"
      : "date_trunc('day', NOW() AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'Asia/Karachi'";

    const [now, today, pages, funnel, viewed] = await Promise.all([
      query("SELECT COUNT(*)::int AS n FROM visitors WHERE last_seen > NOW() - INTERVAL '5 minutes'"),
      query(`SELECT COUNT(*)::int AS visitors, COALESCE(SUM(page_views),0)::int AS views
             FROM visitors WHERE first_seen >= ${since}`),
      query(`SELECT COALESCE(NULLIF(page_title,''), path) AS page, COUNT(*)::int AS n
             FROM visitors WHERE last_seen > NOW() - INTERVAL '5 minutes'
             GROUP BY 1 ORDER BY n DESC LIMIT 6`),
      // Where people stop. Each stage counts sessions that reached at least
      // that far, so the numbers only ever fall as you read down.
      query(`SELECT COUNT(*)::int                                        AS visitors,
                    COUNT(*) FILTER (WHERE viewed_product)::int          AS viewed_product,
                    COUNT(*) FILTER (WHERE added_to_cart)::int           AS added_to_cart,
                    COUNT(*) FILTER (WHERE started_checkout)::int        AS started_checkout,
                    COUNT(*) FILTER (WHERE ordered)::int                 AS ordered
             FROM visitors WHERE first_seen >= ${since}`),
      // Which products got looked at, counted once per visitor per product.
      query(`SELECT slug,
                    COALESCE(NULLIF(MAX(title),''), slug)     AS product,
                    COUNT(DISTINCT session_id)::int           AS n
             FROM product_views WHERE created_at >= ${since}
             GROUP BY slug ORDER BY n DESC LIMIT 8`),
    ]);

    // Housekeeping while we are here: sessions older than 30 days are of no
    // use and the table would otherwise grow forever.
    query("DELETE FROM visitors WHERE last_seen < NOW() - INTERVAL '30 days'").catch(() => {});
    query("DELETE FROM product_views WHERE created_at < NOW() - INTERVAL '30 days'").catch(() => {});

    res.json({
      success: true,
      active_now: now.rows[0].n,
      today: { visitors: today.rows[0].visitors, page_views: today.rows[0].views },
      viewing: pages.rows,
      funnel: funnel.rows[0],
      products_viewed: viewed.rows,
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
    const { slug,name,description,category,type,badge,price,compare_price,is_featured,features,variants } = req.body;
    // One transaction for the whole product: a rejected variant used to abort
    // half way and leave a product row behind with no shades attached.
    const product = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO products (slug,name,description,category,type,badge,price,compare_price,is_featured) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
        [slug,name,description,category,type,badge,price,compare_price||null,is_featured||false]
      );
      const pid = rows[0].id;
      if (features?.length)
        for (let i=0;i<features.length;i++)
          await client.query('INSERT INTO product_features (product_id,feature,sort_order) VALUES ($1,$2,$3)', [pid,features[i],i]);
      if (variants?.length)
        for (const v of variants) {
          await client.query('INSERT INTO product_variants (product_id,shade_key,sku,stock_qty) VALUES ($1,$2,$3,$4)', [pid,v.shade_key,skuFor(slug,v.shade_key),v.stock_qty||100]);
        }
      return rows[0];
    });
    res.status(201).json({ success:true, product });
  } catch(err) {
    if (isUnknownShade(err)) return res.status(400).json({ success:false, message:unknownShadeMsg });
    if (isDuplicateSlug(err)) return res.status(409).json({ success:false, message:'A product with that slug already exists.' });
    next(err);
  }
});

router.get('/products/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM products WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success:false, message:'Not found.' });
    const p = rows[0];
    const { rows:variants } = await query(
      'SELECT id,shade_key,sku,stock_qty FROM product_variants WHERE product_id=$1 AND is_active=true ORDER BY id',
      [req.params.id]
    );
    const { rows:features } = await query(
      'SELECT feature FROM product_features WHERE product_id=$1 ORDER BY sort_order',
      [req.params.id]
    );
    res.json({ success:true, product:{ ...p, variants, features: features.map(f=>f.feature) } });
  } catch(err) { next(err); }
});

router.put('/products/:id', async (req, res, next) => {
  try {
    const { name,slug,description,category,type,badge,price,compare_price,is_featured,is_active,features,variants,isFeatured } = req.body;
    // Transactional for the same reason as create, and more so here: the
    // rewrite deletes the old features and variants first, so a failure part
    // way through would otherwise strip a live product of both.
    const product = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE products SET
          name=COALESCE($1,name), slug=COALESCE($2,slug), description=COALESCE($3,description),
          category=COALESCE($4,category), type=COALESCE($5,type), badge=COALESCE($6,badge),
          price=COALESCE($7,price),
          -- Sending compare_price explicitly empty clears the discount;
          -- omitting the field entirely leaves whatever is already there.
          compare_price=CASE WHEN $12::boolean THEN NULL ELSE COALESCE($8,compare_price) END,
          is_featured=COALESCE($9,is_featured), is_active=COALESCE($10,is_active)
         WHERE id=$11 RETURNING *`,
        [name,slug,description,category,type,badge,price,compare_price,
         (is_featured!==undefined?is_featured:isFeatured),is_active,req.params.id,
         Object.prototype.hasOwnProperty.call(req.body,'compare_price') && !compare_price]
      );
      if (!rows.length) return null;
      const pid = req.params.id;
      if (features !== undefined) {
        await client.query('DELETE FROM product_features WHERE product_id=$1', [pid]);
        for (let i=0;i<features.length;i++)
          await client.query('INSERT INTO product_features (product_id,feature,sort_order) VALUES ($1,$2,$3)', [pid,features[i],i]);
      }
      if (variants !== undefined) {
        const newKeys = variants.map(v=>v.shade_key);
        if (newKeys.length) await client.query(
          `DELETE FROM product_variants WHERE product_id=$1 AND shade_key != ALL($2::text[])`,
          [pid, newKeys]
        );
        else await client.query('DELETE FROM product_variants WHERE product_id=$1', [pid]);
        for (const v of variants) {
          const { rows:existing } = await client.query(
            'SELECT id FROM product_variants WHERE product_id=$1 AND shade_key=$2',
            [pid, v.shade_key]
          );
          if (existing.length) {
            await client.query('UPDATE product_variants SET stock_qty=$1 WHERE id=$2', [v.stock_qty||0, existing[0].id]);
          } else {
            await client.query('INSERT INTO product_variants (product_id,shade_key,sku,stock_qty) VALUES ($1,$2,$3,$4)',
              [pid,v.shade_key,skuFor(rows[0].slug,v.shade_key),v.stock_qty||0]);
          }
        }
      }
      return rows[0];
    });
    if (!product) return res.status(404).json({ success:false, message:'Not found.' });
    res.json({ success:true, product });
  } catch(err) {
    if (isUnknownShade(err)) return res.status(400).json({ success:false, message:unknownShadeMsg });
    if (isDuplicateSlug(err)) return res.status(409).json({ success:false, message:'A product with that slug already exists.' });
    next(err);
  }
});

router.get('/products/:id/images', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM product_images WHERE product_id=$1 ORDER BY is_primary DESC, sort_order, id',
      [req.params.id]
    );
    res.json({ success:true, images:rows });
  } catch(err) { next(err); }
});

router.delete('/products/images/:imageId', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT url FROM product_images WHERE id=$1', [req.params.imageId]);
    if (!rows.length) return res.status(404).json({ success:false, message:'Image not found.' });
    const filePath = path.join(__dirname, '../../', rows[0].url);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await query('DELETE FROM product_images WHERE id=$1', [req.params.imageId]);
    res.json({ success:true, message:'Image deleted.' });
  } catch(err) { next(err); }
});

router.put('/variants/:id/stock', async (req, res, next) => {
  try {
    const { rows } = await query('UPDATE product_variants SET stock_qty=$1 WHERE id=$2 RETURNING *', [req.body.stock_qty, req.params.id]);
    res.json({ success:true, variant:rows[0] });
  } catch(err) { next(err); }
});

// Removes the product for good. Features, variants, images and reviews go with
// it via ON DELETE CASCADE; order_items keep their own name/price snapshot and
// only lose product_id (ON DELETE SET NULL), so order history stays intact.
// To hide a product from the store without losing it, PUT is_active:false.
router.delete('/products/:id', async (req, res, next) => {
  try {
    const { rows:images } = await query('SELECT url FROM product_images WHERE product_id=$1', [req.params.id]);
    const { rows } = await query('DELETE FROM products WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success:false, message:'Not found.' });
    // Only after the row is gone, so a failed delete never orphans the files.
    for (const img of images) {
      const filePath = path.join(__dirname, '../../', img.url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    res.json({ success:true, message:'Product deleted.' });
  } catch(err) { next(err); }
});

// Customers
// Built from orders rather than user accounts. Checkout is guest-only — a COD
// shopper never registers — so listing users showed an empty page no matter how
// many orders had come in. Phone number is the identity that actually repeats.
router.get('/customers', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        shipping_phone                                              AS phone,
        MAX(shipping_name)                                          AS full_name,
        MAX(shipping_email)                                         AS email,
        MAX(shipping_city)                                          AS city,
        MAX(shipping_address)                                       AS address,
        COUNT(*)::int                                               AS order_count,
        COALESCE(SUM(total) FILTER (WHERE status <> 'cancelled'),0) AS total_spent,
        MIN(created_at)                                             AS created_at,
        MAX(created_at)                                             AS last_order
      FROM orders
      WHERE shipping_phone IS NOT NULL
      GROUP BY shipping_phone
      ORDER BY MAX(created_at) DESC
    `);
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

// Records a review the shop received somewhere other than the website — a
// WhatsApp message, an Instagram comment, a note with a returned parcel. It
// publishes immediately, since whoever enters it has already seen it.
// The date can be backdated to when the customer actually said it.
router.post('/reviews', async (req, res, next) => {
  try {
    const { product_id, reviewer_name, rating, comment, created_at } = req.body;
    if (!product_id) return res.status(400).json({ success:false, message:'Pick a product.' });
    if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ success:false, message:'Rating must be 1 to 5.' });
    if (!reviewer_name?.trim()) return res.status(400).json({ success:false, message:'Reviewer name is required.' });

    const { rows } = await query(
      `INSERT INTO reviews (product_id,reviewer_name,rating,comment,is_approved,created_at)
       VALUES ($1,$2,$3,$4,true,COALESCE($5::timestamptz, NOW())) RETURNING *`,
      [product_id, reviewer_name.trim(), rating, comment?.trim() || null, created_at || null]
    );
    res.status(201).json({ success:true, review:rows[0] });
  } catch(err) {
    if (err.code === '23503') return res.status(400).json({ success:false, message:'That product no longer exists.' });
    next(err);
  }
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
