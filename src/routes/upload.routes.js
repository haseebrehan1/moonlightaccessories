const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const sharp   = require('sharp');
const { protect, restrictTo } = require('../middleware/auth');
const { query } = require('../config/db');

// Phone cameras produce 2–5 MB files, and a 2 MB PNG per product photo is what
// made the shop crawl on mobile data. Everything is resized and re-encoded as
// JPEG before it is written, which takes a typical upload under 200 KB.
const MAX_WIDTH = 1400;
const QUALITY   = 82;
const UPLOAD_DIR = path.join(__dirname, '../../uploads/products');

// Held in memory so the oversized original is never written to disk at all.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB)||10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['.jpg','.jpeg','.png','.webp'].includes(path.extname(file.originalname).toLowerCase()))
      cb(null, true);
    else cb(new Error('Only JPG, PNG, WEBP allowed'));
  },
});

router.post('/product-image', protect, restrictTo('admin','superadmin'), (req, res, next) => {
  upload.single('image')(req, res, err => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ success: false, message: err.message });
    }
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success:false, message:'No file uploaded.' });

    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive:true });
    // The admin panel uploads a batch in a loop, so a timestamp alone can
    // collide and one photo would overwrite another.
    const filename = `product-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

    // rotate() applies the EXIF orientation phones set, so portrait shots are
    // not served sideways; the tag itself is dropped by the re-encode.
    await sharp(req.file.buffer)
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: QUALITY, mozjpeg: true })
      .toFile(path.join(UPLOAD_DIR, filename));

    const url = `/uploads/products/${filename}`;
    if (req.body.product_id) {
      await query(
        'INSERT INTO product_images (product_id,shade_key,url,is_primary) VALUES ($1,$2,$3,$4)',
        [req.body.product_id, req.body.shade_key||null, url, req.body.is_primary==='true']
      );
    }
    res.json({ success:true, url, filename });
  } catch(err) { next(err); }
});

module.exports = router;
