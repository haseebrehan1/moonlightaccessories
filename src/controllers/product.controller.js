const { query } = require('../config/db');

const enrichProducts = async (products) => {
  if (!products.length) return [];
  const ids = products.map(p => p.id);

  const { rows:variants } = await query(`
    SELECT pv.id, pv.product_id, pv.shade_key, pv.sku, pv.stock_qty,
           s.name as shade_name, s.color_hex, s.is_highlight
    FROM product_variants pv
    JOIN shades s ON s.key = pv.shade_key
    WHERE pv.product_id = ANY($1::uuid[]) AND pv.is_active=true
    ORDER BY s.sort_order
  `, [ids]);

  const { rows:features } = await query(
    'SELECT product_id,feature FROM product_features WHERE product_id=ANY($1::uuid[]) ORDER BY sort_order', [ids]
  );

  const { rows:ratings } = await query(`
    SELECT product_id, ROUND(AVG(rating),1) as avg, COUNT(*) as cnt
    FROM reviews WHERE product_id=ANY($1::uuid[]) AND is_approved=true GROUP BY product_id
  `, [ids]);

  return products.map(p => ({
    ...p,
    variants: variants.filter(v => v.product_id === p.id).map(v => ({
      id: v.id, shade_key: v.shade_key, shade_name: v.shade_name,
      color_hex: v.color_hex, is_highlight: v.is_highlight,
      sku: v.sku, in_stock: v.stock_qty > 0, stock_qty: v.stock_qty,
    })),
    features: features.filter(f => f.product_id === p.id).map(f => f.feature),
    avg_rating:   parseFloat(ratings.find(r => r.product_id === p.id)?.avg || 0),
    review_count: parseInt(ratings.find(r => r.product_id === p.id)?.cnt || 0),
  }));
};

exports.getAll = async (req, res, next) => {
  try {
    const { category, type, min_price, max_price, sort='sort_order', search } = req.query;
    let conds = ['p.is_active=true']; const params = [];
    if (category)  { params.push(category);         conds.push(`p.category=$${params.length}`); }
    if (type)      { params.push(type);              conds.push(`p.type=$${params.length}`); }
    if (min_price) { params.push(min_price);         conds.push(`p.price>=$${params.length}`); }
    if (max_price) { params.push(max_price);         conds.push(`p.price<=$${params.length}`); }
    if (search)    { params.push(`%${search}%`);     conds.push(`p.name ILIKE $${params.length}`); }
    const orderMap = { price_asc:'p.price ASC', price_desc:'p.price DESC', newest:'p.created_at DESC', sort_order:'p.sort_order ASC' };
    const { rows } = await query(`SELECT p.* FROM products p WHERE ${conds.join(' AND ')} ORDER BY ${orderMap[sort]||'p.sort_order ASC'}`, params);
    res.json({ success:true, count:rows.length, products: await enrichProducts(rows) });
  } catch(err) { next(err); }
};

exports.getFeatured = async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM products WHERE is_active=true AND is_featured=true ORDER BY sort_order LIMIT 6');
    res.json({ success:true, products: await enrichProducts(rows) });
  } catch(err) { next(err); }
};

exports.getBySlug = async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM products WHERE slug=$1 AND is_active=true', [req.params.slug]);
    if (!rows.length) return res.status(404).json({ success:false, message:'Product not found.' });
    const [p] = await enrichProducts(rows);
    res.json({ success:true, product:p });
  } catch(err) { next(err); }
};

exports.getById = async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM products WHERE id=$1 AND is_active=true', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success:false, message:'Product not found.' });
    const [p] = await enrichProducts(rows);
    res.json({ success:true, product:p });
  } catch(err) { next(err); }
};

exports.getShades = async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM shades ORDER BY sort_order');
    res.json({ success:true, shades:rows });
  } catch(err) { next(err); }
};

exports.getReviews = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT r.id,r.reviewer_name,r.rating,r.comment,r.created_at,u.full_name
       FROM reviews r LEFT JOIN users u ON u.id=r.user_id
       WHERE r.product_id=$1 AND r.is_approved=true ORDER BY r.created_at DESC`,
      [req.params.id]
    );
    res.json({ success:true, reviews:rows });
  } catch(err) { next(err); }
};

exports.addReview = async (req, res, next) => {
  try {
    const { rating, comment, reviewer_name } = req.body;
    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ success:false, message:'Rating 1-5 required.' });
    await query(
      'INSERT INTO reviews (product_id,user_id,reviewer_name,rating,comment) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, req.user?.id||null, reviewer_name||req.user?.full_name||'Anonymous', rating, comment||null]
    );
    res.status(201).json({ success:true, message:'Review submitted. Pending approval.' });
  } catch(err) { next(err); }
};
