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

    await query(
      `INSERT INTO visitors (session_id, path, page_title, referrer)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (session_id) DO UPDATE
         SET last_seen  = NOW(),
             path       = EXCLUDED.path,
             page_title = EXCLUDED.page_title,
             -- only count a genuine page change, not the once-a-minute ping
             page_views = visitors.page_views + (CASE WHEN visitors.path IS DISTINCT FROM EXCLUDED.path THEN 1 ELSE 0 END)`,
      [sid,
       String(req.body.path || '/').slice(0, 300),
       String(req.body.title || '').slice(0, 200),
       String(req.body.referrer || '').slice(0, 400)]
    );
  } catch (e) {
    // Analytics must never surface an error to a shopper.
  }
  res.status(204).end();
});

module.exports = router;
