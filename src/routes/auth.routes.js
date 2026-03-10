const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth');

router.post('/register', [
  body('full_name').trim().notEmpty().withMessage('Name required'),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min:8 }).withMessage('Password min 8 chars'),
  body('phone').optional().matches(/^(\+92|0)[0-9]{10}$/).withMessage('Valid PK phone required'),
], ctrl.register);

router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], ctrl.login);

router.post('/logout',  protect, ctrl.logout);
router.post('/refresh', ctrl.refreshToken);
router.get('/me',       protect, ctrl.getMe);

module.exports = router;
