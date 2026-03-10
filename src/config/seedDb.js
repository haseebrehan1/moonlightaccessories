require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('./db');
const bcrypt = require('bcryptjs');

const SHADES = [
  { key:'black',   name:'Natural Black',         color_hex:'#1c1208', is_highlight:false, sort_order:1 },
  { key:'choco',   name:'Choco Brown',            color_hex:'#5c2e10', is_highlight:false, sort_order:2 },
  { key:'hazel',   name:'Hazel Olive',            color_hex:'#9b7535', is_highlight:false, sort_order:3 },
  { key:'blackHL', name:'Black + Gold Highlight', color_hex:'#1c1208', is_highlight:true,  sort_order:4 },
  { key:'chocoHL', name:'Choco + Gold Highlight', color_hex:'#5c2e10', is_highlight:true,  sort_order:5 },
  { key:'hazelHL', name:'Hazel + Gold Highlight', color_hex:'#9b7535', is_highlight:true,  sort_order:6 },
];

const PRODUCTS = [
  { slug:'straight-03-black', name:'Straight 03-Piece', badge:'Bestseller', category:'straight', type:'straight',
    price:3374, is_featured:false,
    desc:'Premium synthetic straight hair extension set of 3 pieces. Blends naturally for added volume and length.',
    features:['3-piece clip-in set','Straight texture','Heat-resistant synthetic fiber','Secure claw clip attachment'],
    variants:[{sk:'black',stock:50},{sk:'choco',stock:45},{sk:'hazel',stock:40},{sk:'blackHL',stock:35},{sk:'chocoHL',stock:30},{sk:'hazelHL',stock:0}] },
  { slug:'straight-03-hazel', name:'Straight 03-Piece', badge:null, category:'straight', type:'straight',
    price:3374, is_featured:false,
    desc:'Warm hazel olive tone straight extensions for a sun-kissed dimensional look.',
    features:['3-piece clip-in set','Hazel Olive shade','Natural sheen finish','Easy to apply'],
    variants:[{sk:'hazel',stock:40},{sk:'hazelHL',stock:30},{sk:'black',stock:50},{sk:'choco',stock:45}] },
  { slug:'blowdry-black', name:'Synthetic Blow Dry', badge:'New', category:'blowdry', type:'blowdry',
    price:4499, is_featured:false,
    desc:'Voluminous blow-dry style extension for instant glamour. Adds massive body to any look.',
    features:['Blow-dry voluminous style','Full body & bounce','Silky synthetic fiber','Clip-in attachment'],
    variants:[{sk:'black',stock:30},{sk:'hazel',stock:25},{sk:'hazelHL',stock:20},{sk:'choco',stock:22}] },
  { slug:'blowdry-hazel', name:'Synthetic Blow Dry', badge:null, category:'blowdry', type:'blowdry',
    price:4499, is_featured:false,
    desc:'Hazel blow-dry extensions with beautiful bouncy volume and warm tones.',
    features:['Blow-dry style','Hazel Olive shade','Bouncy full volume','Soft silky texture'],
    variants:[{sk:'hazel',stock:25},{sk:'hazelHL',stock:20},{sk:'black',stock:30}] },
  { slug:'blowdry-hazel-hl', name:'Synthetic Blow Dry', badge:'New', category:'blowdry', type:'blowdry',
    price:4499, is_featured:true,
    desc:'Hazel with olive gold highlights — multi-tonal blow-dry style for a dimensional, glamorous finish.',
    features:['Blow-dry voluminous style','Hazel + Gold highlights','Multi-tonal dimension','Premium finish'],
    variants:[{sk:'hazelHL',stock:20},{sk:'hazel',stock:25},{sk:'chocoHL',stock:18}] },
  { slug:'straight-full-set', name:'Straight Full Set', badge:'Premium', category:'straight', type:'straight',
    price:6637, is_featured:true,
    desc:'Our premium full straight extension collection with ombre finish — salon quality at home.',
    features:['Complete full extension set','Multiple shades available','Ombre gradient finish','Salon-quality synthetic fiber'],
    variants:[{sk:'choco',stock:20},{sk:'chocoHL',stock:18},{sk:'hazel',stock:15},{sk:'hazelHL',stock:14},{sk:'black',stock:22}] },
  { slug:'straight-choco-hl', name:'Straight 03-Piece', badge:null, category:'straight', type:'straight',
    price:3374, is_featured:true,
    desc:'Choco brown with olive gold highlight streaks — a warm luxurious combination for bold styling.',
    features:['3-piece clip-in set','Choco + Gold highlights','Straight texture','Soft premium fiber'],
    variants:[{sk:'chocoHL',stock:30},{sk:'choco',stock:40},{sk:'blackHL',stock:25}] },
  { slug:'straight-black-hl', name:'Straight 03-Piece', badge:null, category:'straight', type:'straight',
    price:3374, is_featured:false,
    desc:'Classic black base with subtle olive gold highlight panels for a chic modern contrast look.',
    features:['3-piece clip-in set','Black + Olive Gold highlights','Straight texture','Heat-resistant fiber'],
    variants:[{sk:'blackHL',stock:25},{sk:'black',stock:50},{sk:'hazelHL',stock:20}] },
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
