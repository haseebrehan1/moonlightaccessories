#!/usr/bin/env node
/**
 * Turns the current prices into sale prices.
 *
 * Every product keeps the price it has now — that stays what the customer
 * pays — and gets an original price of double it, so the storefront shows the
 * old price crossed out with "50% OFF".
 *
 * Products that already have an original price are left alone, so running this
 * twice cannot compound the discount into 75%, 87.5% and so on.
 *
 *   node scripts/set-sale-prices.js --dry-run     # report only
 *   node scripts/set-sale-prices.js               # apply
 *   node scripts/set-sale-prices.js --multiplier 2.5
 *   node scripts/set-sale-prices.js --clear       # remove every discount
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../src/config/db');

const args = process.argv.slice(2);
const DRY   = args.includes('--dry-run');
const CLEAR = args.includes('--clear');
const MULT  = parseFloat((args[args.indexOf('--multiplier') + 1]) || '2') || 2;
const rs = n => 'Rs. ' + Math.round(n).toLocaleString('en-PK');

async function main() {
  if (CLEAR) {
    const { rowCount } = DRY
      ? await pool.query('SELECT 1 FROM products WHERE compare_price IS NOT NULL')
      : await pool.query('UPDATE products SET compare_price=NULL WHERE compare_price IS NOT NULL');
    console.log(`\n  ${DRY ? 'would clear' : 'cleared'} the discount on ${rowCount} product(s)\n`);
    return;
  }

  const { rows } = await pool.query(
    'SELECT id, name, price, compare_price FROM products ORDER BY name, created_at'
  );
  console.log(`\n${rows.length} product(s)${DRY ? '   (dry run — nothing will change)' : ''}\n`);

  let changed = 0, already = 0;
  for (const p of rows) {
    const price = parseFloat(p.price);

    if (p.compare_price !== null) {
      const pct = Math.round((p.compare_price - price) / p.compare_price * 100);
      console.log(`  skip  ${p.name} — already ${rs(price)} was ${rs(p.compare_price)} (${pct}% off)`);
      already++;
      continue;
    }

    const compare = Math.round(price * MULT);
    const pct = Math.round((compare - price) / compare * 100);
    if (!DRY) await pool.query('UPDATE products SET compare_price=$1 WHERE id=$2', [compare, p.id]);
    console.log(`  set   ${p.name} — ${rs(price)}, was ${rs(compare)}  (${pct}% off)`);
    changed++;
  }

  console.log(`\n  ${DRY ? 'would update' : 'updated'} ${changed}, left alone ${already}\n`);
}

main()
  .then(() => pool.end())
  .catch(err => { console.error('failed:', err.message); process.exit(1); });
