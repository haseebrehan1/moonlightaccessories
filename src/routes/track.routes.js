const router = require('express').Router();
const { query } = require('../config/db');

/**
 * Visitor heartbeat.
 *
 * The storefront posts here on load and once a minute while its tab is
 * visible. One row per session, updated in place, so counting who is on the
 * site right now is an indexed count rather than a scan over a page-view log.
 *
 * No personal data and no IP address is stored — only a random id the browser
 * generates for itself, which disappears when the tab closes.
 */
router.post('/', async (req, res) => {
  try {
    const sid = String(req.body.sid || '').slice(0, 40);
    // Ignore anything that is not one of our generated ids.
    if (!/^[a-z0-9]{8,40}$/i.test(sid)) return res.status(204).end();

    // Funnel stages only ever move forward: a shopper who reached checkout is
    // still counted as having viewed a product when their next ping arrives.
    const e = String(req.body.event || '');
    const viewed   = e === 'view_product';
    const carted   = e === 'add_to_cart';
    const checkout = e === 'checkout_started';
    const ordered  = e === 'ordered';

    await query(
      `INSERT INTO visitors (session_id, path, page_title, referrer,
                             viewed_product, added_to_cart, started_checkout, ordered)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (session_id) DO UPDATE
         SET last_seen  = NOW(),
             path       = EXCLUDED.path,
             -- a ping that carries no title must not erase the one we have
             page_title = COALESCE(NULLIF(EXCLUDED.page_title, ''), visitors.page_title),
             -- only count a genuine page change, not the once-a-minute ping
             page_views = visitors.page_views + (CASE WHEN visitors.path IS DISTINCT FROM EXCLUDED.path THEN 1 ELSE 0 END),
             viewed_product   = visitors.viewed_product   OR EXCLUDED.viewed_product,
             added_to_cart    = visitors.added_to_cart    OR EXCLUDED.added_to_cart,
             started_checkout = visitors.started_checkout OR EXCLUDED.started_checkout,
             ordered          = visitors.ordered          OR EXCLUDED.ordered`,
      [sid,
       String(req.body.path || '/').slice(0, 300),
       String(req.body.title || '').slice(0, 200),
       String(req.body.referrer || '').slice(0, 400),
       viewed, carted, checkout, ordered]
    );

    // Record the view itself, so a product keeps its credit after the shopper
    // moves on to another product or to checkout.
    if (viewed) {
      const slug = (String(req.body.path || '').match(/^\/product\/([^/?#]+)/) || [])[1];
      if (slug) {
        await query(
          'INSERT INTO product_views (session_id, slug, title) VALUES ($1,$2,$3)',
          [sid, decodeURIComponent(slug).slice(0, 200), String(req.body.title || '').slice(0, 200)]
        );
      }
    }
  } catch (e) {
    // Analytics must never surface an error to a shopper.
  }
  res.status(204).end();
});

module.exports = router;
