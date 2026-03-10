const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { protect, restrictTo } = require('../middleware/auth');
const { query } = require('../config/db');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/products');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `product-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB)||5) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['.jpg','.jpeg','.png','.webp'].includes(path.extname(file.originalname).toLowerCase()))
      cb(null, true);
    else cb(new Error('Only JPG, PNG, WEBP allowed'));
  },
});

router.post('/product-image', protect, restrictTo('admin','superadmin'), upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success:false, message:'No file uploaded.' });
    const url = `/uploads/products/${req.file.filename}`;
    // Optionally save to DB
    if (req.body.product_id) {
      await query(
        'INSERT INTO product_images (product_id,shade_key,url,is_primary) VALUES ($1,$2,$3,$4)',
        [req.body.product_id, req.body.shade_key||null, url, req.body.is_primary==='true']
      );
    }
    res.json({ success:true, url, filename:req.file.filename });
  } catch(err) { next(err); }
});

module.exports = router;
