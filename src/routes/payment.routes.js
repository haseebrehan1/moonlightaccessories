const router  = require('express').Router();
const crypto  = require('crypto');
const { query } = require('../config/db');
const { optionalAuth } = require('../middleware/auth');

function jazzHash(params, salt) {
  const str = salt + '&' + Object.keys(params).sort().filter(k => params[k] !== '').map(k => params[k]).join('&');
  return crypto.createHmac('sha256', salt).update(str).digest('hex').toUpperCase();
}

// Initiate JazzCash payment
router.post('/jazzcash/initiate', optionalAuth, async (req, res, next) => {
  try {
    const { order_id } = req.body;
    const { rows } = await query('SELECT * FROM orders WHERE id=$1', [order_id]);
    if (!rows.length) return res.status(404).json({ success:false, message:'Order not found.' });
    const order = rows[0];
    const dt  = new Date().toISOString().replace(/[-T:.Z]/g,'').substring(0,14);
    const exp = new Date(Date.now()+3600000).toISOString().replace(/[-T:.Z]/g,'').substring(0,14);
    const ref = `T${dt}${Math.floor(Math.random()*9000+1000)}`;
    const amt = String(Math.round(parseFloat(order.total)*100));
    const salt = process.env.JAZZCASH_INTEGRITY_SALT || 'SALT';

    const params = {
      pp_Version:'1.1', pp_TxnType:'MWALLET', pp_Language:'EN',
      pp_MerchantID: process.env.JAZZCASH_MERCHANT_ID||'MERCHANT',
      pp_SubMerchantID:'',
      pp_Password: process.env.JAZZCASH_PASSWORD||'PASSWORD',
      pp_BankID:'TBANK', pp_ProductID:'RETL',
      pp_TxnRefNo: ref, pp_Amount: amt, pp_TxnCurrency:'PKR',
      pp_TxnDateTime: dt, pp_BillReference: order.order_number,
      pp_Description: `Moonlight Order ${order.order_number}`,
      pp_TxnExpiryDateTime: exp,
      pp_ReturnURL: `${process.env.FRONTEND_URL}/payment/callback`,
      pp_SecureHash:'', ppmpf_1:'',ppmpf_2:'',ppmpf_3:'',ppmpf_4:'',ppmpf_5:'',
    };
    params.pp_SecureHash = jazzHash(params, salt);
    await query('UPDATE orders SET jazzcash_txn_ref=$1 WHERE id=$2', [ref, order.id]);
    res.json({ success:true, redirect_url: process.env.JAZZCASH_URL || 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/', form_data:params });
  } catch(err) { next(err); }
});

// JazzCash callback
router.post('/jazzcash/callback', async (req, res, next) => {
  try {
    const { pp_TxnRefNo, pp_ResponseCode, pp_SecureHash } = req.body;
    const p = { ...req.body }; delete p.pp_SecureHash;
    const expected = jazzHash(p, process.env.JAZZCASH_INTEGRITY_SALT||'SALT');
    if (expected !== pp_SecureHash) return res.status(400).json({ success:false, message:'Invalid signature.' });
    const ok = pp_ResponseCode === '000';
    await query(
      "UPDATE orders SET payment_status=$1,jazzcash_txn_id=$2,jazzcash_response=$3,status=$4 WHERE jazzcash_txn_ref=$5",
      [ok?'paid':'failed', pp_TxnRefNo, JSON.stringify(req.body), ok?'confirmed':'pending', pp_TxnRefNo]
    );
    res.redirect(ok
      ? `${process.env.FRONTEND_URL}/order-success?ref=${pp_TxnRefNo}`
      : `${process.env.FRONTEND_URL}/order-failed?ref=${pp_TxnRefNo}`
    );
  } catch(err) { next(err); }
});

// Cash on delivery
router.post('/cod', optionalAuth, async (req, res, next) => {
  try {
    const { order_id } = req.body;
    const { rows } = await query(
      "UPDATE orders SET status='confirmed',payment_status='cod_pending' WHERE id=$1 AND payment_method='cod' RETURNING order_number",
      [order_id]
    );
    if (!rows.length) return res.status(404).json({ success:false, message:'COD order not found.' });
    res.json({ success:true, message:'COD order confirmed.', order_number:rows[0].order_number });
  } catch(err) { next(err); }
});

module.exports = router;
