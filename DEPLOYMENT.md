# IINVSYS Sales OS — Deployment Guide

Manual step-by-step instructions for deploying the full-stack Sales Dashboard to production using **Vercel** (frontend + backend) and **MongoDB Atlas** (database).

---

## Project Structure

```
Sales_Dashboard/
├── index.html          ← Frontend (single-page app)
├── styles.css          ← Frontend styles
├── app.js              ← Frontend logic
├── vercel.json         ← Vercel routing config
└── backend/
    ├── api.js          ← Vercel serverless entry point
    ├── server.js       ← Local dev entry (uses app.listen)
    ├── package.json
    └── src/
        ├── app.js      ← Express app (CORS, routes, middleware)
        ├── config/     ← DB connection (db.js)
        ├── controllers/
        ├── models/
        ├── routes/
        └── utils/
            └── seed.js ← Database seeder
```

---

## Prerequisites

| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| Node.js | 18.x | Backend runtime |
| npm | 8.x | Package manager |
| Git | any | Version control |
| Vercel CLI | latest | Deployment |
| MongoDB Atlas account | — | Cloud database |

---

## Part 1 — MongoDB Atlas Setup

### 1.1 Create a Cluster

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com) and sign in.
2. Click **Build a Database** → choose **M0 Free Tier**.
3. Select a cloud provider and region (pick one close to your users).
4. Name the cluster (e.g., `Cluster0`) and click **Create**.

### 1.2 Create a Database User

1. In the left sidebar, go to **Database Access** → **Add New Database User**.
2. Choose **Password** authentication.
3. Enter a username (e.g., `iinvsys`) and a strong password.
4. Set role to **Atlas admin** or **Read and write to any database**.
5. Click **Add User**.

### 1.3 Allow Network Access

1. In the left sidebar, go to **Network Access** → **Add IP Address**.
2. Click **Allow Access from Anywhere** (adds `0.0.0.0/0`).
   > This is required because Vercel uses dynamic outbound IPs.
3. Click **Confirm**.

### 1.4 Get the Connection String

1. Go to **Database** → click **Connect** on your cluster.
2. Choose **Drivers** → select **Node.js**.
3. Copy the connection string. It looks like:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
   ```
4. Replace `<username>` and `<password>` with your credentials.
5. Add the database name before `?`:
   ```
   mongodb+srv://iinvsys:yourpassword@cluster0.xxxxx.mongodb.net/iinvsys?retryWrites=true&w=majority&appName=Cluster0
   ```

---

## Part 2 — Local Development

### 2.1 Clone and Install

```bash
git clone <your-repo-url>
cd Sales_Dashboard/backend
npm install
```

### 2.2 Configure Environment Variables

Create `backend/.env`:

```env
PORT=5001
NODE_ENV=development
MONGO_URI=mongodb+srv://iinvsys:yourpassword@cluster0.xxxxx.mongodb.net/iinvsys?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=<generate a 64+ character random hex string>
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:3456
```

**Generate a JWT secret:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 2.3 Seed the Database

```bash
cd backend
npm run seed
```

This creates demo users, agents, products, expos, and leads.

### 2.4 Run the Backend

```bash
cd backend
npm run dev       # development (auto-restart with nodemon)
# or
npm start         # production-like
```

API runs on `http://localhost:5001`

### 2.5 Serve the Frontend

From the project root (`Sales_Dashboard/`):

```bash
npx serve -p 3456 .
```

Open `http://localhost:3456` in your browser.

---

## Part 3 — Vercel Deployment

### 3.1 Install Vercel CLI

```bash
npm install -g vercel
```

> If you don't have global install permissions:
> ```bash
> npm install vercel --prefix /tmp/vercel-local
> # Then use: /tmp/vercel-local/node_modules/.bin/vercel
> ```

### 3.2 Log In to Vercel

```bash
vercel login
```

Follow the browser prompt to authenticate.

### 3.3 Link the Project

From the `Sales_Dashboard/` root:

```bash
vercel link
```

- Select your Vercel account/team
- Create a new project named `iinvsys-sales` (or your preferred name)

### 3.4 Set Environment Variables

> **Critical:** Use `printf '%s'` (NOT `echo`) to pipe values — `echo` appends a trailing newline that Vercel stores literally, breaking JWT auth and `NODE_ENV` checks.

```bash
# MongoDB connection string
printf '%s' 'mongodb+srv://iinvsys:yourpassword@cluster0.xxxxx.mongodb.net/iinvsys?retryWrites=true&w=majority&appName=Cluster0' \
  | vercel env add MONGO_URI production

# JWT secret (64+ char hex)
printf '%s' 'your_jwt_secret_here' \
  | vercel env add JWT_SECRET production

# JWT expiry
printf '%s' '7d' \
  | vercel env add JWT_EXPIRES_IN production

# Node environment
printf '%s' 'production' \
  | vercel env add NODE_ENV production
```

**Verify all variables are set:**
```bash
vercel env ls
```

### 3.5 Deploy

```bash
vercel --prod --yes
```

Vercel will:
1. Build the backend (`backend/api.js`) as a serverless function
2. Deploy frontend static files (`index.html`, `styles.css`, `app.js`)
3. Apply routing rules from `vercel.json`
4. Alias to `https://iinvsys-sales.vercel.app`

---

## Part 4 — Verify the Deployment

### 4.1 Health Check

```bash
curl https://iinvsys-sales.vercel.app/api/health
# Expected: {"success":true,"status":"ok","environment":"production"}
```

### 4.2 Smoke Test Login

```bash
curl -s -X POST https://iinvsys-sales.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@iinvsys.com","password":"Admin@123"}' | python3 -m json.tool
# Expected: {"success":true,"token":"...", ...}
```

### 4.3 Open in Browser

Visit `https://iinvsys-sales.vercel.app` and log in with any demo credential.

---

## Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@iinvsys.com | Admin@123 |
| Sales Agent | rahul@iinvsys.com | Agent@123 |
| Sales Agent | priya@iinvsys.com | Agent@123 |

---

## Part 5 — Re-deploying After Changes

After making code changes:

```bash
git add .
git commit -m "Your change description"
vercel --prod --yes
```

---

## Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGO_URI` | Yes | MongoDB Atlas connection string (include DB name) |
| `JWT_SECRET` | Yes | Secret key for signing JWTs — min 32 chars, keep private |
| `JWT_EXPIRES_IN` | Yes | Token expiry, e.g. `7d`, `24h`, `30m` |
| `NODE_ENV` | Yes | Must be `production` on Vercel |
| `CORS_ORIGIN` | No | Allowed CORS origin (defaults to `*`) |

---

## Vercel Routing (`vercel.json`)

```json
{
  "version": 2,
  "builds": [
    { "src": "backend/api.js", "use": "@vercel/node" },
    { "src": "index.html",  "use": "@vercel/static" },
    { "src": "styles.css",  "use": "@vercel/static" },
    { "src": "app.js",      "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "/backend/api.js" },
    { "src": "/styles.css", "dest": "/styles.css" },
    { "src": "/app.js",    "dest": "/app.js" },
    { "src": "/(.*)",      "dest": "/index.html" }
  ]
}
```

All `/api/*` requests route to the Express serverless function. Everything else serves the static frontend.

---

## Troubleshooting

### `404 NOT_FOUND` on the live URL
Static files not included in the build. Verify `vercel.json` has `@vercel/static` builders for `index.html`, `styles.css`, and `app.js`. Redeploy.

### `Internal server error` on login
Usually a bad `JWT_SECRET` value (e.g., trailing newline from `echo`). Re-add using `printf '%s'`:
```bash
vercel env rm JWT_SECRET production
printf '%s' 'your_secret' | vercel env add JWT_SECRET production
vercel --prod --yes
```

### `503 Database unavailable`
MongoDB Atlas is blocking the connection. Check:
1. **Network Access** in Atlas → confirm `0.0.0.0/0` is whitelisted
2. **MONGO_URI** in Vercel env vars → confirm the password and DB name are correct
3. The DB user has **read/write** permissions

### `ECONNREFUSED` on localhost port 5000
macOS ControlCenter occupies port 5000. Use `PORT=5001` in `backend/.env`.

### Env var changes not taking effect
After changing Vercel env vars you must redeploy:
```bash
vercel --prod --yes
```

---

## Local MongoDB (Optional, for offline dev)

If you want to run without Atlas, start MongoDB via Docker:

```bash
cd backend
docker-compose up -d mongo
```

Then set in `backend/.env`:
```env
MONGO_URI=mongodb://localhost:27017/iinvsys
```
