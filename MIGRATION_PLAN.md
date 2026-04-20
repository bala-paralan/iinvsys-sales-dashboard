# Migration Plan — IINVSYS Sales Dashboard to On-Premise Server

**Target environment:** On-premise physical server at IINVSYS, static public IP, Docker Compose deployment, reachable at `https://sales.iinvsys.com` (GoDaddy-managed DNS), TLS via Let's Encrypt.

**Current environment:** Frontend on Vercel, backend + MongoDB hosted on-premise.

**Migration lead / on-call:** Balap (balap@iinvsys.com)

**Prepared:** 2026-04-20

---

## About your SSL question

Your existing certificate for `iinvsys.com` **will not cover** `sales.iinvsys.com` unless it is one of:

1. A **wildcard certificate** issued for `*.iinvsys.com` — covers any single-level subdomain.
2. A **SAN / multi-domain certificate** that explicitly lists `sales.iinvsys.com` in the Subject Alternative Names.

A standard single-host cert issued for `iinvsys.com` covers only the apex (plus `www.iinvsys.com` if that SAN was included). Browsers will show a certificate mismatch error on `sales.iinvsys.com` otherwise.

**Three ways forward — pick one in Phase 3 below:**

| Option | Cost | Effort | Notes |
|---|---|---|---|
| Upgrade GoDaddy cert to wildcard `*.iinvsys.com` | Paid (~$90–$300/yr) | Re-issue + install | Covers every future subdomain too. Best long-term. |
| Buy a separate GoDaddy cert for `sales.iinvsys.com` | Paid (~$60–$100/yr) | Re-issue + install | Cheapest GoDaddy-only path if you only need one subdomain. |
| Use **Let's Encrypt** for `sales.iinvsys.com` | Free | Certbot auto-renew | Leave apex on GoDaddy cert, get a free 90-day auto-renewing cert just for the subdomain. Recommended. |

Recommendation: **Let's Encrypt for the subdomain.** Zero cost, automated renewal, and doesn't touch the existing GoDaddy cert on `iinvsys.com`.

---

## Phase overview

| Phase | Scope | Est. time |
|---|---|---|
| 1. Pre-flight & inventory | Decide subdomain, verify server specs, take backups | 1–2 hours |
| 2. Server provisioning | OS hardening, Docker install, firewall, user accounts | 2–3 hours |
| 3. DNS & TLS | Point subdomain to server, issue certificate | 1 hour + DNS propagation |
| 4. Application deployment | Clone repo, configure `.env`, `docker compose up`, seed DB | 1–2 hours |
| 5. Nginx reverse proxy | Serve frontend + proxy `/api/*` with HTTPS | 1 hour |
| 6. Data migration | Export MongoDB from current environment, import into new | 1–3 hours (data-size dependent) |
| 7. Validation & cutover | Smoke tests, user acceptance, DNS flip | 2–4 hours |
| 8. Post-cutover hardening | Backups, monitoring, update runbook | Ongoing |

**Total window for cutover day:** ~4–6 hours with a pre-staged server. Plan a low-traffic window (e.g., weekend or after-hours).

---

## Phase 1 — Pre-flight & inventory

**Decisions to lock in before you touch the server:**

1. **Subdomain:** `sales.iinvsys.com` — confirmed.
2. **Server access path:** Static public IP — confirmed. Verify the ISP router permits inbound 80/443 and that the IP is stable (not rebooting back to a different lease).
3. **Backup owner:** Balap (self). Confirm admin access to the current Vercel project and the current on-prem MongoDB instance for the data export in Phase 6.

**Pre-flight checklist:**

- [ ] Confirm server meets minimum specs: 2 vCPU / 2 GB RAM / 20 GB SSD, Ubuntu 22.04 LTS.
- [ ] Confirm static public IP is stable and router forwards 80/443 → server's LAN IP.
- [ ] Confirm admin access to GoDaddy DNS for `iinvsys.com`.
- [ ] Confirm source-of-truth Git repo is current: `github.com/bala-paralan/iinvsys-sales-dashboard`.
- [ ] Take a full backup of the **existing** on-premise MongoDB before touching anything.
- [ ] Inventory env secrets currently in use (JWT_SECRET, MONGO_URI, CORS_ORIGINS, mail creds, etc.) and store them in a password manager — you'll re-use them or rotate in Phase 4.

---

## Phase 2 — Server provisioning

On the fresh Ubuntu 22.04 box:

```bash
# System updates + essentials
sudo apt update && sudo apt upgrade -y
sudo apt install -y ufw fail2ban unattended-upgrades curl git

# Docker 24+ and Compose v2
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version

# Firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

**Do NOT expose 5000 (API) or 27017 (MongoDB) to the public** — Nginx proxies them on localhost.

**Harden SSH** (optional but recommended):

- Disable root login and password auth in `/etc/ssh/sshd_config` → use SSH keys only.
- Change the SSH port if the server is internet-facing.

---

## Phase 3 — DNS & TLS

### 3a. Create the GoDaddy DNS record

In GoDaddy → DNS Management for `iinvsys.com`, add:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `sales` | `<your-static-public-IP>` | 600 |

Verify propagation before issuing a cert:

```bash
dig sales.iinvsys.com +short
# Should return your static public IP
```

### 3b. Issue the certificate (Let's Encrypt path)

Install Nginx and Certbot on the server:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Temporarily serve an empty site for the HTTP-01 challenge, then run:

```bash
sudo certbot --nginx -d sales.iinvsys.com \
  --non-interactive --agree-tos -m balap@iinvsys.com --redirect
```

Certbot will install the cert, update the Nginx config to listen on 443, and schedule an auto-renew systemd timer. Verify:

```bash
sudo systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

**If using a GoDaddy wildcard instead:** upload the cert chain (`.crt` + intermediate) and private key (`.key`) to `/etc/ssl/iinvsys/`, then configure `ssl_certificate` / `ssl_certificate_key` in the Nginx server block (see Phase 5).

---

## Phase 4 — Application deployment

```bash
sudo mkdir -p /opt/iinvsys
sudo chown $USER:$USER /opt/iinvsys
cd /opt/iinvsys
git clone https://github.com/bala-paralan/iinvsys-sales-dashboard.git .
cd backend
cp .env.example .env
```

Edit `backend/.env`:

```env
NODE_ENV=production
PORT=5000
MONGO_URI=mongodb://mongo:27017/iinvsys
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
JWT_EXPIRES_IN=7d
CORS_ORIGINS=https://sales.iinvsys.com
```

Start the stack:

```bash
docker compose up -d --build
docker compose ps     # both containers should be (healthy)
curl http://localhost:5000/api/health
```

Seed the database (only on a brand-new install — skip if you're restoring a dump in Phase 6):

```bash
docker compose exec api node src/utils/seed.js
```

> Rotate every default password immediately after first login.

---

## Phase 5 — Nginx reverse proxy with HTTPS

Replace the Certbot-generated server block with the production config at `/etc/nginx/sites-available/iinvsys`:

```nginx
# HTTP → HTTPS redirect
server {
    listen 80;
    server_name sales.iinvsys.com;
    return 301 https://$host$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name sales.iinvsys.com;

    ssl_certificate     /etc/letsencrypt/live/sales.iinvsys.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sales.iinvsys.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header X-Frame-Options           "SAMEORIGIN" always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;

    # Frontend static files
    root /var/www/iinvsys;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API reverse proxy
    location /api/ {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    client_max_body_size 25M;
}
```

Deploy frontend static files:

```bash
sudo mkdir -p /var/www/iinvsys
sudo cp /opt/iinvsys/{index.html,styles.css,app.js} /var/www/iinvsys/
sudo chown -R www-data:www-data /var/www/iinvsys

sudo ln -sf /etc/nginx/sites-available/iinvsys /etc/nginx/sites-enabled/iinvsys
sudo nginx -t && sudo systemctl reload nginx
```

Then confirm: `https://sales.iinvsys.com` should load the dashboard with a valid lock icon.

---

## Phase 6 — Data migration

**From the current on-premise MongoDB:**

```bash
mongodump --uri="<CURRENT_MONGO_URI>" --out=/tmp/iinvsys-dump-$(date +%F)
tar czf iinvsys-dump.tgz -C /tmp iinvsys-dump-*
scp iinvsys-dump.tgz user@<new-server>:/tmp/
```

**On the new server:**

```bash
tar xzf /tmp/iinvsys-dump.tgz -C /tmp/
docker cp /tmp/iinvsys-dump-* iinvsys_mongo:/tmp/dump
docker compose exec mongo mongorestore --drop /tmp/dump/iinvsys
```

Validate counts:

```bash
docker compose exec mongo mongosh iinvsys --eval \
  "['users','agents','products','expos','leads'].forEach(c => print(c, db[c].countDocuments()))"
```

Counts on new should equal counts on old. If not, stop and investigate before cutover.

---

## Phase 7 — Validation & cutover

**Smoke tests (use the subdomain over HTTPS):**

- [ ] `https://sales.iinvsys.com` loads, no mixed-content warnings, valid cert.
- [ ] `https://sales.iinvsys.com/api/health` returns `{success: true}`.
- [ ] Log in as superadmin, manager, agent, readonly — all four roles work.
- [ ] Create a test lead end-to-end; verify it persists after a page refresh.
- [ ] Run the test flows in `TESTING_GUIDE.md` and `functional_test_report.md`.
- [ ] Confirm CORS: the frontend makes successful API calls (check browser devtools Network tab, no CORS errors).
- [ ] Confirm JWT expiry behaves (7d by default).

**Cutover steps:**

1. Announce maintenance window.
2. Put the current production in read-only / maintenance mode if possible.
3. Run one final `mongodump` → `mongorestore` so the new DB has the latest data (Phase 6 delta).
4. Flip DNS — if the previous app was at `iinvsys.com` itself, update the apex A record only after you've verified `sales.iinvsys.com` works.
5. Monitor logs live: `docker compose logs -f api` and `sudo tail -f /var/log/nginx/error.log`.
6. Communicate "migration complete" to users.

**Rollback plan:** Keep the old Vercel deployment and old DB intact for at least 7 days. If a blocker appears, revert the DNS A record to the old host; DNS TTL of 600s means ≤10-minute rollback.

---

## Phase 8 — Post-cutover hardening

**Backups (mandatory):**

```bash
# /etc/cron.d/iinvsys-backup
0 2 * * *  root  docker exec iinvsys_mongo mongodump --archive=/backup/iinvsys-$(date +\%F).archive --gzip
```

- Mount a separate backup volume or ship archives offsite (S3, Backblaze, another VM).
- Retention: 7 daily + 4 weekly + 3 monthly is a reasonable default.
- Test a restore at least once — a backup you haven't tested is not a backup.

**Monitoring:**

- Uptime check on `https://sales.iinvsys.com/api/health` (UptimeRobot free tier, Better Uptime, or cron + curl → email).
- Disk-space alert on `/var/lib/docker` at 80%.
- Log rotation: Docker's default `json-file` driver grows unbounded — configure `max-size=50m`, `max-file=5` in `/etc/docker/daemon.json`.

**Operational runbook to update:**

- Document the exact restore procedure from the nightly dump.
- Document cert renewal check (`certbot renew --dry-run` monthly).
- Document the process to deploy a code update (`git pull && docker compose up -d --build api && systemctl reload nginx`).
- Add all passwords/secrets to the company password manager, not a text file on the server.

**Security follow-ups:**

- Rotate `JWT_SECRET` (invalidates all sessions — do this on cutover day).
- Rotate all default seeded passwords.
- Enable MongoDB auth (see Option B / step B3 in `ONPREMISE_HOSTING.md`) even though the port is localhost-only.
- Enable `unattended-upgrades` for security patches: `sudo dpkg-reconfigure -plow unattended-upgrades`.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| ISP blocks inbound 80/443 | Confirm with ISP before Phase 3; fall back to Cloudflare Tunnel if blocked. |
| Static IP changes unexpectedly (ISP reassignment) | Get written confirmation of the static assignment from the ISP; monitor with a cron that alerts if the public IP drifts. |
| Certificate rate-limiting during testing | Use Let's Encrypt `--staging` flag while iterating, switch to production cert only when Nginx config is final. |
| Data loss during migration | Dump + restore twice — once days before for a dry run, once during cutover. Retain old DB for 7+ days. |
| Power/network outage | UPS on the server; document an RTO and consider a warm standby if this is business-critical. |
| CORS misconfig after cutover | Set `CORS_ORIGINS=https://sales.iinvsys.com` exactly — no trailing slash, include scheme. |
| Browser caches old frontend | Add `Cache-Control` headers, or hard-refresh instructions for first users after cutover. |

---

## Decisions locked in

| Question | Answer |
|---|---|
| Subdomain | `sales.iinvsys.com` |
| Server location | On-premise physical server |
| Network | Static public IP, 80/443 forwarded to server |
| TLS | Let's Encrypt (Certbot, auto-renew) |
| Deploy method | Docker Compose |
| Cutover on-call | Balap (balap@iinvsys.com) |
