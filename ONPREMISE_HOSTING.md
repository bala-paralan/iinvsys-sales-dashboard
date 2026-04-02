# IINVSYS Sales Dashboard — On-Premise Hosting Guide

Complete step-by-step procedure to host the full stack (frontend + API + MongoDB) on your own server or VM — no cloud dependency required.

Two paths are documented:

| Path | Best for | Requires |
|------|----------|----------|
| **Option A — Docker Compose** | Production servers, easiest setup | Docker 24+, Docker Compose v2 |
| **Option B — Manual / Bare-Metal** | VMs without Docker, legacy infra | Ubuntu 22.04 / RHEL 9, Node.js 20, MongoDB 7 |

Both paths produce the same result: MongoDB on port 27017, API on port 5001, frontend served by Nginx on port 80/443.

---

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 2 GB | 4 GB |
| Disk | 20 GB SSD | 50 GB SSD |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| Network | Static LAN IP or domain | Domain with DNS A record |

Ports that must be open on your firewall:

| Port | Service | Exposed to |
|------|---------|-----------|
| 80 | Nginx (HTTP) | LAN / Internet |
| 443 | Nginx (HTTPS) | LAN / Internet |
| 5001 | Node.js API | Localhost only (Nginx proxy) |
| 27017 | MongoDB | Localhost only (never exposed) |

---

## Option A — Docker Compose (Recommended)

### A1 — Install Docker

```bash
# Ubuntu 22.04
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker $USER
newgrp docker
docker --version          # Docker version 24+
docker compose version    # Docker Compose version v2+
```

### A2 — Get the Code

```bash
git clone https://github.com/balaaarc/iinvsys-sales-dashboard.git
cd iinvsys-sales-dashboard
```

### A3 — Create the Environment File

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:

```env
NODE_ENV=production
PORT=5000

# MongoDB — uses the Docker service name 'mongo' as hostname
MONGO_URI=mongodb://mongo:27017/iinvsys

# Generate a strong secret:
# node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=REPLACE_WITH_64_CHAR_HEX_STRING

JWT_EXPIRES_IN=7d

# Set to your server's LAN IP or domain — the URL users open in their browser
CORS_ORIGINS=http://192.168.1.100,http://yourdomain.local
```

> ⚠️ **Never commit `.env` to Git.** It contains your JWT secret.

### A4 — Review docker-compose.yml

The existing `backend/docker-compose.yml` defines two services: `mongo` and `api`.
The API waits for MongoDB to pass a health check before starting.
MongoDB data is persisted in a named Docker volume `mongo_data`.

```
mongo  (port 27017, internal only)
  └── api  (port 5000, mapped to host)
```

### A5 — Build and Start

```bash
# From the backend/ directory
cd /path/to/iinvsys-sales-dashboard/backend

docker compose up -d --build
```

**First start takes 2–3 minutes** (pulls `node:20-alpine` and `mongo:7` images, builds the app layer).

Verify both containers are healthy:

```bash
docker compose ps
# NAME             STATUS
# iinvsys_mongo   Up (healthy)
# iinvsys_api     Up (healthy)
```

Check the API:

```bash
curl http://localhost:5000/api/health
# {"success":true,"status":"healthy",...}
```

### A6 — Seed the Database

Run once after first start to create demo users, agents, products, expos, and leads:

```bash
docker compose exec api node src/utils/seed.js
```

Output:
```
✅  Seed complete!
  superadmin  →  admin@iinvsys.com   / Admin@123
  manager     →  sneha@iinvsys.com   / Manager@123
  agent       →  rahul@iinvsys.com   / Agent@123
  readonly    →  readonly@iinvsys.com / Read@1234
```

> ⚠️ **Change all default passwords immediately after first login.**

### A7 — Install and Configure Nginx (Frontend + Reverse Proxy)

Nginx serves the static frontend files and forwards `/api/*` requests to the Node.js API.

```bash
sudo apt install -y nginx
```

Create `/etc/nginx/sites-available/iinvsys`:

```nginx
server {
    listen 80;
    server_name _;          # Replace _ with your domain or LAN IP

    # ── Frontend (static files) ──────────────────────────────────────
    root /var/www/iinvsys;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;   # SPA fallback
    }

    # ── API reverse proxy ────────────────────────────────────────────
    location /api/ {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/iinvsys /etc/nginx/sites-enabled/
sudo nginx -t          # test config syntax
sudo systemctl reload nginx
```

### A8 — Deploy Frontend Files

```bash
sudo mkdir -p /var/www/iinvsys
sudo cp /path/to/iinvsys-sales-dashboard/{index.html,styles.css,app.js} /var/www/iinvsys/
sudo chown -R www-data:www-data /var/www/iinvsys
```

### A9 — Open the Application

Navigate to `http://<server-ip>` in any browser on the LAN.

---

### A10 — Docker Management Commands

```bash
# View live logs
docker compose logs -f api
docker compose logs -f mongo

# Stop all services
docker compose down

# Stop and wipe all data (destructive)
docker compose down -v

# Restart only the API after code changes
docker compose restart api

# Rebuild after code changes
docker compose up -d --build api

# Shell into the running API container
docker compose exec api sh

# Shell into MongoDB
docker compose exec mongo mongosh iinvsys
```

---

## Option B — Manual / Bare-Metal (No Docker)

Use this if Docker is not available on your server.

### B1 — Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version    # v20.x.x
npm --version     # 10.x.x
```

### B2 — Install MongoDB 7

```bash
# Import MongoDB GPG key
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc \
  | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg

# Add repo
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] \
  https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" \
  | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

sudo apt update
sudo apt install -y mongodb-org

# Start and enable
sudo systemctl start mongod
sudo systemctl enable mongod
sudo systemctl status mongod     # should show: active (running)
```

Verify MongoDB is running:

```bash
mongosh --eval "db.adminCommand('ping')"
# { ok: 1 }
```

### B3 — (Recommended) Create a MongoDB Application User

```bash
mongosh
```

Inside the MongoDB shell:

```javascript
use iinvsys

db.createUser({
  user: "iinvsys_app",
  pwd:  "StrongPassword123!",
  roles: [{ role: "readWrite", db: "iinvsys" }]
})

exit
```

Enable MongoDB authentication:

```bash
sudo nano /etc/mongod.conf
```

Find and update the security section:

```yaml
security:
  authorization: enabled
```

```bash
sudo systemctl restart mongod
```

### B4 — Create a Dedicated System User

```bash
sudo useradd --system --no-create-home --shell /bin/false iinvsys
```

### B5 — Deploy the Application

```bash
# Clone the repo (or scp/rsync from your machine)
sudo mkdir -p /opt/iinvsys
sudo git clone https://github.com/balaaarc/iinvsys-sales-dashboard.git /opt/iinvsys
sudo chown -R iinvsys:iinvsys /opt/iinvsys

# Install backend dependencies (production only)
cd /opt/iinvsys/backend
sudo -u iinvsys npm ci --omit=dev
```

### B6 — Create the Environment File

```bash
sudo nano /opt/iinvsys/backend/.env
```

```env
NODE_ENV=production
PORT=5001

# If you created a MongoDB user:
MONGO_URI=mongodb://iinvsys_app:StrongPassword123!@127.0.0.1:27017/iinvsys?authSource=iinvsys
# Without auth:
# MONGO_URI=mongodb://127.0.0.1:27017/iinvsys

# Generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=REPLACE_WITH_64_CHAR_HEX_STRING

JWT_EXPIRES_IN=7d
CORS_ORIGINS=http://192.168.1.100,http://yourdomain.local
```

```bash
# Restrict permissions — only the app user should read this
sudo chown iinvsys:iinvsys /opt/iinvsys/backend/.env
sudo chmod 600 /opt/iinvsys/backend/.env
```

### B7 — Seed the Database

```bash
cd /opt/iinvsys/backend
sudo -u iinvsys node src/utils/seed.js
```

### B8 — Create a systemd Service

This ensures the API starts automatically on boot and restarts on crash.

```bash
sudo nano /etc/systemd/system/iinvsys-api.service
```

```ini
[Unit]
Description=IINVSYS Sales Dashboard API
After=network.target mongod.service
Requires=mongod.service

[Service]
Type=simple
User=iinvsys
Group=iinvsys
WorkingDirectory=/opt/iinvsys/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=iinvsys-api

# Environment — load from file
EnvironmentFile=/opt/iinvsys/backend/.env

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/iinvsys/backend

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable iinvsys-api
sudo systemctl start iinvsys-api
sudo systemctl status iinvsys-api   # should show: active (running)
```

Verify the API is responding:

```bash
curl http://localhost:5001/api/health
# {"success":true,"status":"healthy",...}
```

### B9 — Install and Configure Nginx

```bash
sudo apt install -y nginx
```

Create `/etc/nginx/sites-available/iinvsys`:

```nginx
server {
    listen 80;
    server_name _;          # Replace with your domain or LAN IP

    # ── Frontend ────────────────────────────────────────────────────
    root /var/www/iinvsys;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # ── API Proxy ───────────────────────────────────────────────────
    location /api/ {
        proxy_pass         http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/iinvsys /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default    # remove default page
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
```

### B10 — Deploy Frontend Files

```bash
sudo mkdir -p /var/www/iinvsys
sudo cp /opt/iinvsys/{index.html,styles.css,app.js} /var/www/iinvsys/
sudo chown -R www-data:www-data /var/www/iinvsys
```

### B11 — Configure Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

MongoDB (27017) and the API (5001) are intentionally **not** opened — they are only accessible from localhost via Nginx.

---

## Part C — HTTPS / TLS (Both Options)

### C1 — Using Let's Encrypt (Public Domain)

Requires a publicly accessible domain with a DNS A record pointing to your server.

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
# Follow the interactive prompts
sudo systemctl reload nginx
```

Certbot auto-renews certificates. Verify auto-renewal:

```bash
sudo certbot renew --dry-run
```

### C2 — Self-Signed Certificate (Internal LAN)

For use on an internal network where Let's Encrypt is not available.

```bash
sudo openssl req -x509 -nodes -days 3650 -newkey rsa:4096 \
  -keyout /etc/ssl/private/iinvsys.key \
  -out /etc/ssl/certs/iinvsys.crt \
  -subj "/C=IN/ST=Delhi/L=Delhi/O=IINVSYS/CN=192.168.1.100"
```

Update `/etc/nginx/sites-available/iinvsys`:

```nginx
server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;    # redirect all HTTP → HTTPS
}

server {
    listen 443 ssl;
    server_name _;

    ssl_certificate     /etc/ssl/certs/iinvsys.crt;
    ssl_certificate_key /etc/ssl/private/iinvsys.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    root /var/www/iinvsys;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass         http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_read_timeout 60s;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

> Users will need to accept a browser security warning for self-signed certs. For an internal CA, distribute the `.crt` to client machines.

---

## Part D — MongoDB Backup & Restore

### D1 — Manual Backup

```bash
# Dump the entire iinvsys database
mongodump --uri="mongodb://127.0.0.1:27017/iinvsys" \
  --out=/var/backups/iinvsys/$(date +%Y-%m-%d_%H-%M)

# If auth is enabled:
mongodump --uri="mongodb://iinvsys_app:PASSWORD@127.0.0.1:27017/iinvsys?authSource=iinvsys" \
  --out=/var/backups/iinvsys/$(date +%Y-%m-%d_%H-%M)
```

### D2 — Automated Daily Backups via Cron

```bash
sudo mkdir -p /var/backups/iinvsys
sudo crontab -e
```

Add this line (runs at 2:00 AM every day, keeps 30 days of backups):

```cron
0 2 * * * mongodump --uri="mongodb://127.0.0.1:27017/iinvsys" --out=/var/backups/iinvsys/$(date +\%Y-\%m-\%d) && find /var/backups/iinvsys -maxdepth 1 -mtime +30 -type d -exec rm -rf {} +
```

### D3 — Restore from Backup

```bash
# Stop the API first to avoid write conflicts
sudo systemctl stop iinvsys-api   # or: docker compose stop api

mongorestore --uri="mongodb://127.0.0.1:27017/iinvsys" \
  --drop \
  /var/backups/iinvsys/2026-04-02_02-00/iinvsys/

sudo systemctl start iinvsys-api  # or: docker compose start api
```

---

## Part E — Updates & Redeployment

### Option A (Docker)

```bash
cd /opt/iinvsys
git pull origin main

cd backend
docker compose up -d --build api
docker compose exec api node src/utils/seed.js   # only if schema changed
```

### Option B (Bare-Metal)

```bash
cd /opt/iinvsys
sudo -u iinvsys git pull origin main

cd backend
sudo -u iinvsys npm ci --omit=dev

# Restart the API
sudo systemctl restart iinvsys-api

# Redeploy frontend files
sudo cp /opt/iinvsys/{index.html,styles.css,app.js} /var/www/iinvsys/
sudo chown -R www-data:www-data /var/www/iinvsys
```

---

## Part F — Monitoring & Logs

### View API Logs

```bash
# Docker
docker compose logs -f api --tail=100

# Bare-metal (systemd journal)
sudo journalctl -u iinvsys-api -f --since "1 hour ago"
```

### View Nginx Access / Error Logs

```bash
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Check Service Status

```bash
# Bare-metal
sudo systemctl status iinvsys-api
sudo systemctl status mongod
sudo systemctl status nginx

# Docker
docker compose ps
docker stats iinvsys_api iinvsys_mongo
```

### MongoDB Health Check

```bash
mongosh --eval "db.adminCommand('ping')" --quiet
# { ok: 1 }
```

### API Health Check

```bash
curl -s http://localhost:5001/api/health | python3 -m json.tool
```

---

## Part G — Verification Checklist

Run these after every install or update to confirm the stack is working end-to-end.

```bash
# 1. MongoDB is running
sudo systemctl status mongod      # active (running)
# or
docker compose ps | grep mongo    # Up (healthy)

# 2. API health
curl -s http://localhost:5001/api/health
# Expected: {"success":true,"status":"healthy",...}

# 3. Login works
curl -s -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@iinvsys.com","password":"Admin@123"}' \
  | python3 -m json.tool | grep '"token"'
# Expected: "token": "eyJ..."

# 4. Frontend is served by Nginx
curl -s -o /dev/null -w "%{http_code}" http://localhost/
# Expected: 200

# 5. Nginx proxies /api through to Node.js
curl -s http://localhost/api/health
# Expected: {"success":true,"status":"healthy",...}
```

---

## Part H — Troubleshooting

| Problem | Diagnosis | Fix |
|---------|-----------|-----|
| API container exits immediately | `docker compose logs api` | Check `.env` — `JWT_SECRET` and `MONGO_URI` must be set |
| `MongoServerError: Authentication failed` | Wrong MongoDB credentials | Verify `MONGO_URI` username/password; or disable auth for testing |
| `ECONNREFUSED 127.0.0.1:27017` | MongoDB not running | `sudo systemctl start mongod` or `docker compose up mongo` |
| `502 Bad Gateway` on `/api/` | Nginx can't reach Node.js | Verify `proxy_pass` port matches `PORT` in `.env`; check `systemctl status iinvsys-api` |
| `403 Forbidden` on frontend | Nginx can't read static files | `sudo chown -R www-data:www-data /var/www/iinvsys` |
| Settings page shows "forEach is not a function" | Old frontend code cached | Hard refresh browser (Ctrl+Shift+R); re-copy `app.js` to `/var/www/iinvsys/` |
| Port 5000 already in use | macOS AirPlay uses 5000 | Set `PORT=5001` in `.env` and update `proxy_pass` in Nginx to `http://127.0.0.1:5001` |
| JWT tokens rejected after server restart | `JWT_SECRET` changed | Keep the same `JWT_SECRET` value across restarts; changing it invalidates all sessions |
| MongoDB data lost after Docker restart | Volume not mounted | Confirm `mongo_data` volume exists: `docker volume ls` |

---

## Part I — Directory Structure Reference

```
/opt/iinvsys/                     ← project root (bare-metal)
├── index.html                    ← frontend (copied to /var/www/iinvsys)
├── styles.css
├── app.js
└── backend/
    ├── .env                      ← secrets (chmod 600, never in Git)
    ├── server.js                 ← app entry point
    ├── docker-compose.yml        ← Docker Compose definition
    ├── Dockerfile                ← API container build
    ├── package.json
    └── src/
        ├── app.js                ← Express app (CORS, routes, rate limiting)
        ├── config/db.js          ← MongoDB connection
        ├── controllers/          ← business logic
        ├── models/               ← Mongoose schemas
        ├── routes/               ← route definitions
        ├── middleware/           ← auth, RBAC, error handler
        └── utils/
            └── seed.js           ← demo data seeder

/var/www/iinvsys/                 ← Nginx web root
├── index.html
├── styles.css
└── app.js

/var/backups/iinvsys/             ← MongoDB backups
/etc/nginx/sites-available/iinvsys ← Nginx config
/etc/systemd/system/iinvsys-api.service ← systemd unit
```

---

## Demo Credentials (after seeding)

| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@iinvsys.com | Admin@123 |
| Manager | sneha@iinvsys.com | Manager@123 |
| Sales Agent | rahul@iinvsys.com | Agent@123 |
| Read Only | readonly@iinvsys.com | Read@1234 |

> **Change all passwords immediately** after first login in production.
> Settings → (via API): `PUT /api/auth/password`

---

*IINVSYS Sales Dashboard — On-Premise Hosting Guide v1.0 — 2026-04-02*
