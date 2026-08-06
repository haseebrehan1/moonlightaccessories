# Deployment

Production runs on a Hetzner VPS serving `moonlightaccessories.pk`.

```
                    moonlightaccessories.pk  (DNS A record @ Paki Hosting)
                                 │
                            nginx :80/:443
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
  /  → frontend           /admin → admin.html        /api/ → proxy
  /var/www/               /var/www/                  127.0.0.1:5000
  moonlight-frontend      moonlight-backend          (systemd: moonlight-api)
                                                            │
                                                     PostgreSQL (localhost)
```

Two repos are involved:

| Repo | Path on server | Serves |
|---|---|---|
| `moonlightaccessories` (this one) | `/var/www/moonlight-backend` | API, admin panel, `/uploads` |
| `moonlight-frontend` | `/var/www/moonlight-frontend` | the storefront |

## First-time setup on a fresh server

As root on a bare Ubuntu 22.04/24.04 box:

```bash
curl -fsSL https://raw.githubusercontent.com/haseebrehan1/moonlightaccessories/master/deploy/provision.sh -o provision.sh
bash provision.sh
```

This installs Node 20, PostgreSQL, nginx and certbot; creates the database and
a `.env` with freshly generated secrets; enables the `moonlight-api` service;
and requests a Let's Encrypt certificate. It prints the generated admin
password at the end — **change it after first login.**

Point the `moonlightaccessories.pk` A record at the server *before* running it,
or certbot will fail (everything else still succeeds; re-run certbot after DNS
propagates).

The script is safe to re-run and will not overwrite an existing `.env`.

## Deploying changes

Push to `master`, then on the server:

```bash
bash /var/www/moonlight-backend/deploy/deploy.sh
```

Pulls both repos, reinstalls dependencies, restarts the API and verifies
`/api/health`. It never touches `.env`, the database, or `uploads/`.

## Operations

```bash
systemctl status moonlight-api        # is it running?
journalctl -u moonlight-api -f        # live logs
systemctl restart moonlight-api       # restart
nginx -t && systemctl reload nginx    # after editing nginx config
curl localhost:5000/api/health        # bypass nginx, test Node directly
```

## Notes worth keeping in mind

**The service is `enable`d, which is the point.** The site previously went down
after a rebuild because nothing was configured to start on boot. `systemctl
enable --now moonlight-api` plus `Restart=always` means the API comes back after
a reboot or a crash without anyone logging in.

**Schema and seed data are automatic.** `src/server.js` runs `setupDb` and
`seedDb` on first boot when `NODE_ENV=production`, so a fresh database
populates itself. Real orders and customers are *not* covered by this — see
backups below.

**`client_max_body_size` is set to 12M** in the nginx config. nginx defaults to
1M, which would reject product image uploads with a 413 before Node ever sees
them, despite `MAX_FILE_SIZE_MB=10`.

**The admin panel must be same-origin.** `admin.html` hardcodes
`API_BASE = '/api/v1'`, so it only works when served from the same host as the
API — hence the `/admin` location block rather than opening it from disk.

## Backups — not yet configured

There is currently no automated backup. The database and `uploads/` exist only
on this server, and the site has already been lost once this way. At minimum,
enable **Hetzner automatic backups or a scheduled snapshot** in the Cloud
console, and consider a nightly `pg_dump` off-box:

```bash
# /etc/cron.daily/moonlight-backup
sudo -u postgres pg_dump moonlight_db | gzip > /var/backups/moonlight-$(date +\%F).sql.gz
find /var/backups -name 'moonlight-*.sql.gz' -mtime +14 -delete
```

A snapshot alone would have made the last outage a ten-minute restore.
