const router = require('express').Router();
const { optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/product.controller');

router.get('/',                ctrl.getAll);
router.get('/featured',        ctrl.getFeatured);
router.get('/shades',          ctrl.getShades);
router.get('/slug/:slug',      ctrl.getBySlug);
router.get('/:id',             ctrl.getById);
router.get('/:id/reviews',     ctrl.getReviews);
router.post('/:id/reviews', optionalAuth, ctrl.addReview);

module.exports = router;
