require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('./db');
const bcrypt = require('bcryptjs');

// The shades a product may be sold in. This table is the single source of
// truth: product_variants.shade_key is a foreign key into it, and both the
// storefront and the admin panel read it from GET /products/shades.
const SHADES = [
  { key:'jetblack',   name:'Jet Black',    color_hex:'#0a0a0a', is_highlight:false, sort_order:1 },
  { key:'mokka',      name:'Mokka Brown',  color_hex:'#4e2a14', is_highlight:false, sort_order:2 },
  { key:'darkbrown',  name:'Dark Brown',   color_hex:'#3a1c08', is_highlight:false, sort_order:3 },
  { key:'lightbrown', name:'Light Brown',  color_hex:'#7a4020', is_highlight:false, sort_order:4 },
  { key:'mahogany',   name:'Mahogany',     color_hex:'#6e1e14', is_highlight:false, sort_order:5 },
];

const PRODUCTS = [
  { slug:'straight-03-black', name:'Straight 03-Piece', badge:'Bestseller', category:'straight', type:'straight',
    price:3374, is_featured:false,
    desc:'Premium synthetic straight hair extension set of 3 pieces. Blends naturally for added volume and length.',
    features:['3-piece clip-in set','Straight texture','Heat-resistant synthetic fiber','Secure claw clip attachment'],
    variants:[{sk:'jetblack',stock:50},{sk:'mokka',stock:45},{sk:'lightbrown',stock:40},{sk:'darkbrown',stock:35},{sk:'mahogany',stock:30}] },
  { slug:'straight-03-hazel', name:'Straight 03-Piece', badge:null, category:'straight', type:'straight',
    price:3374, is_featured:false,
    desc:'Warm hazel olive tone straight extensions for a sun-kissed dimensional look.',
    features:['3-piece clip-in set','Hazel Olive shade','Natural sheen finish','Easy to apply'],
    variants:[{sk:'lightbrown',stock:40},{sk:'mahogany',stock:30},{sk:'jetblack',stock:50},{sk:'mokka',stock:45}] },
  { slug:'blowdry-black', name:'Synthetic Blow Dry', badge:'New', category:'blowdry', type:'blowdry',
    price:4499, is_featured:false,
    desc:'Voluminous blow-dry style extension for instant glamour. Adds massive body to any look.',
    features:['Blow-dry voluminous style','Full body & bounce','Silky synthetic fiber','Clip-in attachment'],
    variants:[{sk:'jetblack',stock:30},{sk:'lightbrown',stock:25},{sk:'mahogany',stock:20},{sk:'mokka',stock:22}] },
  { slug:'blowdry-hazel', name:'Synthetic Blow Dry', badge:null, category:'blowdry', type:'blowdry',
    price:4499, is_featured:false,
    desc:'Hazel blow-dry extensions with beautiful bouncy volume and warm tones.',
    features:['Blow-dry style','Hazel Olive shade','Bouncy full volume','Soft silky texture'],
    variants:[{sk:'lightbrown',stock:25},{sk:'mahogany',stock:20},{sk:'jetblack',stock:30}] },
  { slug:'blowdry-hazel-hl', name:'Synthetic Blow Dry', badge:'New', category:'blowdry', type:'blowdry',
    price:4499, is_featured:true,
    desc:'Hazel with olive gold highlights — multi-tonal blow-dry style for a dimensional, glamorous finish.',
    features:['Blow-dry voluminous style','Hazel + Gold highlights','Multi-tonal dimension','Premium finish'],
    variants:[{sk:'mahogany',stock:20},{sk:'lightbrown',stock:25},{sk:'darkbrown',stock:18}] },
  { slug:'straight-full-set', name:'Straight Full Set', badge:'Premium', category:'straight', type:'straight',
    price:6637, is_featured:true,
    desc:'Our premium full straight extension collection with ombre finish — salon quality at home.',
    features:['Complete full extension set','Multiple shades available','Ombre gradient finish','Salon-quality synthetic fiber'],
    variants:[{sk:'mokka',stock:20},{sk:'mahogany',stock:18},{sk:'lightbrown',stock:15},{sk:'darkbrown',stock:14},{sk:'jetblack',stock:22}] },
  { slug:'straight-choco-hl', name:'Straight 03-Piece', badge:null, category:'straight', type:'straight',
    price:3374, is_featured:true,
    desc:'Choco brown with olive gold highlight streaks — a warm luxurious combination for bold styling.',
    features:['3-piece clip-in set','Choco + Gold highlights','Straight texture','Soft premium fiber'],
    variants:[{sk:'mahogany',stock:30},{sk:'mokka',stock:40},{sk:'darkbrown',stock:25}] },
  { slug:'straight-black-hl', name:'Straight 03-Piece', badge:null, category:'straight', type:'straight',
    price:3374, is_featured:false,
    desc:'Classic black base with subtle olive gold highlight panels for a chic modern contrast look.',
    features:['3-piece clip-in set','Black + Olive Gold highlights','Straight texture','Heat-resistant fiber'],
    variants:[{sk:'darkbrown',stock:25},{sk:'jetblack',stock:50},{sk:'mahogany',stock:20}] },
];

async function seed() {
  console.log('🌱 Seeding database...\n');
  for (const sh of SHADES) {
    await pool.query(
      'INSERT INTO shades (key,name,color_hex,is_highlight,sort_order) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO UPDATE SET name=$2',
      [sh.key, sh.name, sh.color_hex, sh.is_highlight, sh.sort_order]
    );
  }
  console.log('  ✓ Shades');

  // Sample catalogue, for a brand new database only. This runs on every boot
  // in production, so re-applying it would undo the shop's own work: deleted
  // products would reappear, and prices and stock edited in the admin panel
  // would be reset to these values at the next restart.
  const { rows:[{ count }] } = await pool.query('SELECT count(*)::int FROM products');
  if (count > 0) {
    console.log(`  · Catalogue already has ${count} products — leaving it alone`);
  } else {
    for (const p of PRODUCTS) {
      const { rows } = await pool.query(
        'INSERT INTO products (slug,name,description,category,type,badge,price,is_featured) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (slug) DO UPDATE SET price=$7,is_featured=$8 RETURNING id',
        [p.slug, p.name, p.desc, p.category, p.type, p.badge, p.price, p.is_featured]
      );
      const pid = rows[0].id;
      await pool.query('DELETE FROM product_features WHERE product_id=$1', [pid]);
      for (let i=0; i<p.features.length; i++)
        await pool.query('INSERT INTO product_features (product_id,feature,sort_order) VALUES ($1,$2,$3)', [pid, p.features[i], i]);
      for (const v of p.variants) {
        const sku = `ML-${p.slug.replace(/-/g,'').toUpperCase()}-${v.sk.toUpperCase()}`;
        await pool.query(
          'INSERT INTO product_variants (product_id,shade_key,sku,stock_qty) VALUES ($1,$2,$3,$4) ON CONFLICT (product_id,shade_key) DO UPDATE SET stock_qty=$4',
          [pid, v.sk, sku, v.stock]
        );
      }
      console.log(`  ✓ Product: ${p.name} [${p.slug}]`);
    }
  }

  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@123', 12);
  await pool.query(
    "INSERT INTO users (full_name,email,password_hash,role,is_verified) VALUES ($1,$2,$3,'admin',true) ON CONFLICT (email) DO NOTHING",
    ['Admin', process.env.ADMIN_EMAIL || 'admin@moonlightaccessories.pk', hash]
  );
  console.log('  ✓ Admin user\n');
  console.log('✅ Database seeded!\n');
  console.log('  Admin:', process.env.ADMIN_EMAIL || 'admin@moonlightaccessories.pk');
  console.log('  Pass: ', process.env.ADMIN_PASSWORD || 'Admin@123');
  console.log('\n✅ Seed complete\n');
}

async function runSeed() { await seed(); }
module.exports = { runSeed };

if (require.main === module) {
  seed().then(() => pool.end()).catch(err => { console.error('❌', err.message); process.exit(1); });
}
