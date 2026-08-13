#!/usr/bin/env node
/**
 * Re-encodes already-uploaded product photos.
 *
 * Uploads were originally stored exactly as the phone produced them — 2 MB
 * PNGs — which is what made the shop slow on mobile data. Uploads are now
 * compressed on the way in; this fixes the ones that came before.
 *
 * For each row in product_images it writes a resized JPEG beside the original,
 * points the database at it, and only then removes the original. A file that
 * is already a reasonably sized JPEG is left alone.
 *
 *   node scripts/compress-images.js --dry-run   # report only, change nothing
 *   node scripts/compress-images.js             # do it
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const path  = require('path');
const fs    = require('fs');
const sharp = require('sharp');
const { pool } = require('../src/config/db');

const MAX_WIDTH = 1400;
const QUALITY   = 82;
const ROOT      = path.join(__dirname, '..');
const DRY       = process.argv.includes('--dry-run');
const kb        = n => (n / 1024).toFixed(0) + ' KB';

async function main() {
  const { rows } = await pool.query('SELECT id, url FROM product_images ORDER BY id');
  console.log(`\n${rows.length} image row(s)${DRY ? '  (dry run — nothing will change)' : ''}\n`);

  let before = 0, after = 0, converted = 0, skipped = 0, missing = 0;

  for (const row of rows) {
    const abs = path.join(ROOT, row.url);
    if (!fs.existsSync(abs)) {
      console.log(`  MISSING  ${row.url}`);
      missing++;
      continue;
    }

    const size = fs.statSync(abs).size;
    before += size;

    let meta;
    try { meta = await sharp(abs).metadata(); }
    catch (e) { console.log(`  UNREADABLE  ${row.url} — ${e.message}`); skipped++; after += size; continue; }

    // Already small, already JPEG, already narrow enough: leave it be.
    if (meta.format === 'jpeg' && size < 300 * 1024 && meta.width <= MAX_WIDTH) {
      skipped++;
      after += size;
      continue;
    }

    const newName = path.basename(abs).replace(/\.[^.]+$/, '') + '.jpg';
    const newAbs  = path.join(path.dirname(abs), newName);
    const newUrl  = path.posix.join(path.posix.dirname(row.url), newName);

    if (DRY) {
      const buf = await sharp(abs).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer();
      console.log(`  ${path.basename(abs)}  ${meta.width}x${meta.height} ${meta.format}  ${kb(size)} -> ${kb(buf.length)}`);
      after += buf.length;
      converted++;
      continue;
    }

    // Write the replacement first. Only once the row points at it do we remove
    // the original, so a failure here can never leave a broken image on the site.
    const tmp = newAbs + '.tmp';
    await sharp(abs).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: QUALITY, mozjpeg: true }).toFile(tmp);
    fs.renameSync(tmp, newAbs);

    await pool.query('UPDATE product_images SET url=$1 WHERE id=$2', [newUrl, row.id]);

    if (newAbs !== abs) fs.unlinkSync(abs);

    const newSize = fs.statSync(newAbs).size;
    after += newSize;
    converted++;
    console.log(`  ${path.basename(abs)}  ${meta.width}x${meta.height} ${meta.format}  ${kb(size)} -> ${kb(newSize)}`);
  }

  const saved = before - after;
  console.log(`\n  converted ${converted}, left alone ${skipped}${missing ? `, missing ${missing}` : ''}`);
  console.log(`  total ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB` +
              `  (saved ${(saved / 1048576).toFixed(1)} MB, ${before ? Math.round(saved / before * 100) : 0}%)\n`);
}

main()
  .then(() => pool.end())
  .catch(err => { console.error('failed:', err.message); process.exit(1); });
