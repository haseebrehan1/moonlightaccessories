const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/order.controller');
const { protect, optionalAuth } = require('../middleware/auth');

router.post('/', optionalAuth, [
  body('shipping_name').trim().notEmpty(),
  body('shipping_phone').matches(/^(\+92|0)[0-9]{10}$/).withMessage('Valid PK phone required'),
  body('shipping_address').trim().notEmpty(),
  body('shipping_city').trim().notEmpty(),
  body('payment_method').isIn(['cod','jazzcash','easypaisa']),
  body('items').isArray({ min:1 }),
  body('items.*.variant_id').notEmpty(),
  body('items.*.quantity').isInt({ min:1 }),
], ctrl.createOrder);

router.get('/',         protect, ctrl.getMyOrders);
router.get('/:id',      optionalAuth, ctrl.getOrder);
router.put('/:id/cancel', protect, ctrl.cancelOrder);

module.exports = router;
