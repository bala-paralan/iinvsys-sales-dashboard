# IINVSYS Sales Dashboard — Backend API

A production-ready REST API for the IINVSYS Sales Dashboard, built with **Node.js + Express + MongoDB**.

---

## Features

| Feature | Details |
|---|---|
| **Auth** | JWT stateless authentication, bcrypt password hashing |
| **RBAC** | 4-level role hierarchy: `superadmin > manager > agent > readonly` |
| **Agent Scoping** | Agents can only access their own leads |
| **Leads** | Full CRUD, follow-up logging, bulk CSV import, overdue detection |
| **Products** | CRUD (superadmin only), soft-delete |
| **Agents** | CRUD with performance stats |
| **Expos** | CRUD with auto status from dates |
| **Analytics** | KPI overview, monthly trends, expo ROI, top agents |
| **Security** | Helmet headers, rate-limiting, CORS, input validation |
| **Docker** | Dockerfile + docker-compose with health checks |

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- MongoDB ≥ 6 (local or Atlas)

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — set MONGO_URI and JWT_SECRET at minimum
```

**Required variables:**

| Variable | Description |
|---|---|
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Random 64-char string — generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |

### 3. Seed the database

```bash
npm run seed
```

This creates 6 users, 6 agents, 5 products, 3 expos, and 15 leads.

**Demo credentials after seeding:**

| Role | Email | Password |
|---|---|---|
| Super Admin | admin@iinvsys.com | Admin@123 |
| Manager | sneha@iinvsys.com | Manager@123 |
| Agent | rahul@iinvsys.com | Agent@123 |
| Read-Only | readonly@iinvsys.com | Read@1234 |

### 4. Start the server

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

Server starts on `http://localhost:5000`

---

## Running Tests

```bash
npm test
```

Tests use **mongodb-memory-server** — no external MongoDB required.

```bash
npm run test:coverage   # with coverage report
```

---

## Docker Deployment

### Build and run with Docker Compose

```bash
# Set required env vars
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")

docker-compose up -d
```

### Seed inside Docker

```bash
docker-compose exec api node src/utils/seed.js
```

---

## API Reference

Base URL: `http://localhost:5000/api`

### Health Check

```
GET /api/health
```

### Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | ✗ | Login → JWT token |
| GET | `/auth/me` | ✓ | Current user profile |
| POST | `/auth/register` | superadmin | Create user |
| PATCH | `/auth/password` | ✓ | Change password |

### Leads

| Method | Endpoint | Min Role | Description |
|---|---|---|---|
| GET | `/leads` | agent | List leads (agent-scoped) |
| POST | `/leads` | agent | Create lead |
| GET | `/leads/:id` | agent | Get lead |
| PUT | `/leads/:id` | agent | Update lead (agents: stage+notes only) |
| DELETE | `/leads/:id` | manager | Delete lead |
| POST | `/leads/:id/followups` | agent | Log follow-up |
| POST | `/leads/bulk` | manager | Bulk import |

**Query parameters for `GET /leads`:**

| Param | Example | Description |
|---|---|---|
| `stage` | `interested` | Filter by stage |
| `source` | `expo` | Filter by source |
| `assignedAgent` | `<ObjectId>` | Filter by agent |
| `expo` | `<ObjectId>` | Filter by expo |
| `q` | `John` | Full-text search |
| `overdue` | `true` | Only overdue leads |
| `page` | `2` | Page number (default 1) |
| `limit` | `20` | Page size (default 20) |
| `sort` | `-score` | Sort field (prefix `-` for desc) |

### Agents

| Method | Endpoint | Min Role | Description |
|---|---|---|---|
| GET | `/agents` | readonly | List agents |
| POST | `/agents` | manager | Create agent |
| GET | `/agents/:id` | readonly | Get agent |
| GET | `/agents/:id/stats` | readonly | Performance stats |
| PUT | `/agents/:id` | manager | Update agent |
| DELETE | `/agents/:id` | superadmin | Deactivate agent |

### Products

| Method | Endpoint | Min Role | Description |
|---|---|---|---|
| GET | `/products` | readonly | List products |
| POST | `/products` | superadmin | Create product |
| GET | `/products/:id` | readonly | Get product |
| PUT | `/products/:id` | superadmin | Update product |
| DELETE | `/products/:id` | superadmin | Soft-delete product |

### Expos

| Method | Endpoint | Min Role | Description |
|---|---|---|---|
| GET | `/expos` | readonly | List expos |
| POST | `/expos` | manager | Create expo |
| GET | `/expos/:id` | readonly | Get expo |
| PUT | `/expos/:id` | manager | Update expo |
| DELETE | `/expos/:id` | manager | Delete expo |

### Analytics

| Method | Endpoint | Min Role | Description |
|---|---|---|---|
| GET | `/analytics/overview` | agent | KPI cards + breakdowns |
| GET | `/analytics/trends` | agent | Monthly trends + score dist |
| GET | `/analytics/expos` | manager | Expo ROI stats |

---

## Project Structure

```
backend/
├── server.js                  # Entry point — DB connect + listen
├── src/
│   ├── app.js                 # Express app — middleware + routes
│   ├── config/
│   │   └── db.js              # Mongoose connect with reconnect logic
│   ├── middleware/
│   │   ├── auth.js            # JWT authentication
│   │   ├── rbac.js            # Role-based access control
│   │   └── errorHandler.js    # Centralised error handler
│   ├── models/
│   │   ├── User.js
│   │   ├── Agent.js
│   │   ├── Lead.js
│   │   ├── Product.js
│   │   └── Expo.js
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── leadController.js
│   │   ├── agentController.js
│   │   ├── productController.js
│   │   ├── expoController.js
│   │   └── analyticsController.js
│   ├── routes/
│   │   ├── index.js
│   │   ├── auth.js
│   │   ├── leads.js
│   │   ├── agents.js
│   │   ├── products.js
│   │   ├── expos.js
│   │   └── analytics.js
│   └── utils/
│       ├── response.js        # Standardised JSON helpers
│       └── seed.js            # Database seeder
├── tests/
│   ├── helpers/
│   │   ├── globalSetup.js     # Start in-memory MongoDB
│   │   ├── globalTeardown.js  # Stop in-memory MongoDB
│   │   └── db.js              # Connect / clear / disconnect helpers
│   ├── auth.test.js
│   ├── leads.test.js
│   ├── agents.test.js
│   └── products.test.js
├── .env.example
├── .gitignore
├── Dockerfile
├── docker-compose.yml
└── package.json
```

---

## Response Format

All endpoints return a consistent JSON envelope:

```json
{
  "success": true,
  "message": "Success",
  "data": { ... }
}
```

Paginated endpoints include:

```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "total": 42,
    "page": 1,
    "limit": 20,
    "pages": 3
  }
}
```

Error responses:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [{ "msg": "...", "path": "..." }]
}
```

---

## Security Notes

- Passwords are hashed with bcrypt (12 rounds)
- JWT tokens expire in 7 days (configurable via `JWT_EXPIRES_IN`)
- Rate limiting: 200 req/15min general, 20 req/15min on auth endpoints
- Helmet sets security headers (HSTS, CSP, X-Frame-Options, etc.)
- Input sanitised via express-validator on all mutating endpoints
- Agents are hard-scoped at the middleware level — no client-controlled bypass
