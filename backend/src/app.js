'use strict';
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const { requestId, jsonLogger } = require('./middleware/requestContext');
const rateLimit  = require('express-rate-limit');
const compression = require('compression');
const routes     = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

/* ── Trust proxy — required on Vercel/cloud so rate-limiter reads real client IP ── */
app.set('trust proxy', 1);

/* ── Request id ── (N-3)
   First, so every downstream log line and error body can carry it. */
app.use(requestId);

/* ── Security & Transport ── (N-7)
 *
 * helmet()'s default CSP is `default-src 'self'` with `script-src 'self'`,
 * which the LEGACY app cannot satisfy: it loads Chart.js and SheetJS from
 * jsDelivr with no integrity hash, and uses inline handlers throughout. The
 * new React app bundles everything and needs no exception at all.
 *
 * So the policy is scoped to what is actually served:
 *   · The API itself returns only JSON — nothing can execute, and the
 *     strictest possible policy applies.
 *   · The legacy static app keeps a documented CDN allowance until cutover,
 *     which is the point at which this whole block collapses to 'self'.
 *
 * `unsafe-inline` for scripts is NOT granted anywhere. Styles keep it because
 * the legacy app has inline `style=` attributes on generated markup; the React
 * app does too via inline style objects, which CSP treats as attribute styles.
 */
const LEGACY_SCRIPT_HOSTS = ['https://cdn.jsdelivr.net'];
const LEGACY_STYLE_HOSTS = ['https://fonts.cdnfonts.com'];
const SERVES_LEGACY_APP = process.env.SERVE_LEGACY_APP !== 'false';

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...(SERVES_LEGACY_APP ? LEGACY_SCRIPT_HOSTS : [])],
      styleSrc: ["'self'", "'unsafe-inline'", ...(SERVES_LEGACY_APP ? LEGACY_STYLE_HOSTS : [])],
      fontSrc: ["'self'", 'data:', ...(SERVES_LEGACY_APP ? LEGACY_STYLE_HOSTS : [])],
      imgSrc: ["'self'", 'data:', 'blob:'],
      /* blob: — the authenticated xlsx download hands the browser a blob URL,
         because a plain <a href> cannot carry an Authorization header. */
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  /* The API is same-origin with the app; cross-origin embedding of JSON
     responses is not a thing we need and COEP breaks the legacy CDN loads. */
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());

// Build allowed-origin list from CORS_ORIGINS (comma-separated) or CORS_ORIGIN.
// In production the frontend is served from the same origin so the relative /api
// path is used — CORS is only needed when the frontend runs on a different host.
// Falling back to '*' is fine for same-origin deployments but explicit is safer.
const _rawOrigins = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '';
const _allowedOrigins = _rawOrigins
  ? _rawOrigins.split(',').map(o => o.trim()).filter(Boolean)
  : [];

if (!_allowedOrigins.length && process.env.NODE_ENV === 'production') {
  console.warn(
    '⚠️  CORS_ORIGINS is not set. Every origin will be reflected. ' +
    'Set it to the public URL(s) of the frontend.'
  );
}

app.use(cors({
  /* `origin: '*'` is INVALID alongside `credentials: true` — browsers reject
     the response. When no allow-list is configured we reflect the request
     origin instead, which is the valid form of "allow any". */
  origin: _allowedOrigins.length
    ? (origin, cb) => {
        // Allow requests with no origin (server-to-server, curl, health checks)
        if (!origin || _allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`CORS: origin "${origin}" not allowed`));
      }
    : true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
}));

/* ── Rate Limiting ──
   Env names match .env.example. `RATE_LIMIT` is still read as a deprecated
   alias for RATE_LIMIT_MAX so existing deployments do not silently lose
   their configured ceiling. */
const _int = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const RATE_WINDOW_MS = _int(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);

/* Rate limiting is process-global and survives across test cases, which makes
   every auth assertion depend on how many requests ran before it. Skip it under
   test — the same reason morgan is skipped below. Limiter behaviour itself is
   covered separately, not incidentally by 700 unrelated assertions. */
const limiterEnabled = process.env.NODE_ENV !== 'test';
/* Build the limiter ONCE — a limiter constructed per request gets a fresh
   store every time and therefore never limits anything. */
const limit = (opts) => {
  if (!limiterEnabled) return (req, res, next) => next();
  return rateLimit(opts);
};

app.use('/api/', limit({
  windowMs: RATE_WINDOW_MS,
  max: _int(process.env.RATE_LIMIT_MAX || process.env.RATE_LIMIT, 200),
  standardHeaders: true,
  legacyHeaders: false,
  /* N-8: `message`, not `error` — every other response in the API uses
     {success, message}, and the client reads `message`. A rate-limited user
     previously saw "Request failed (429)" because the only human-readable
     text was under a key nothing looked at. */
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many requests, please try again later.',
  },
}));

/* ── Parsing ──
   Must come BEFORE the login limiter below, which keys on the submitted email
   and would otherwise see an undefined req.body. The volumetric limiter above
   stays ahead of parsing so a flood is rejected before any body is read. */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/* ── Stricter limit on auth routes ──
 *
 * Three decisions here, all load-bearing:
 *
 * 1. `skipSuccessfulRequests` — the ceiling applies to FAILED logins only, so a
 *    legitimate user is never locked out by their own successful sign-ins.
 *
 * 2. The key is IP **+ attempted email**, not IP alone. Keyed on IP only, five
 *    fumbled passwords lock out everyone sharing that address — and this system
 *    is used by referrers capturing leads at an expo, all behind one venue's
 *    NAT. One person mistyping their password would take the whole stand
 *    offline for fifteen minutes. Per-account keying still stops brute force
 *    against any single account, and the global 200-req/15-min limiter above
 *    remains the volumetric backstop against someone rotating emails.
 *
 * 3. It is mounted AFTER body parsing, because (2) is impossible otherwise.
 *    Mounted before, req.body is undefined, every attempt collapses onto the
 *    key `<ip>|` and the per-account behaviour silently degrades back to
 *    per-IP — which looks correct in code and is wrong in production.
 */
app.use('/api/auth/login', limit({
  windowMs: RATE_WINDOW_MS,
  max: _int(process.env.AUTH_RATE_LIMIT_MAX, 5),
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    return `${req.ip}|${email}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'LOGIN_RATE_LIMITED',
    message: 'Too many login attempts. Try again in 15 minutes.',
  },
}));

/* ── Logging ── (N-3)
   Structured JSON in production so logs can be queried by status, route and
   duration; morgan's readable line in development. Both carry the request id
   attached above, which is what ties a user's 500 to a log entry. */
if (process.env.NODE_ENV !== 'test') {
  if (process.env.NODE_ENV === 'production') app.use(jsonLogger);
  else app.use(morgan('dev'));
}

/* ── Health and readiness ──
   Two endpoints, deliberately different:
     /api/health  — is this process alive? Never touches the database, so a
                    Mongo outage does not make the orchestrator kill and
                    restart a process that is fine.
     /api/ready   — can it SERVE? Checks the database. A load balancer should
                    drain traffic from an instance that fails this without
                    terminating it. The old single endpoint reported "healthy"
                    with Mongo unreachable and every request failing. */
app.get('/api/health', (req, res) => res.json({
  success: true,
  status: 'healthy',
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
  version: require('../package.json').version,
}));

app.get('/api/ready', async (req, res) => {
  const mongoose = require('mongoose');
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const state = states[mongoose.connection.readyState] || 'unknown';

  let dbOk = mongoose.connection.readyState === 1;
  if (dbOk) {
    /* readyState is the driver's opinion. A ping is the database's. */
    try { await mongoose.connection.db.admin().ping(); } catch { dbOk = false; }
  }

  return res.status(dbOk ? 200 : 503).json({
    success: dbOk,
    status: dbOk ? 'ready' : 'not-ready',
    checks: { database: { ok: dbOk, state } },
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/* ── API Routes ── */
app.use('/api', routes);

/* ── 404 Handler ── */
app.use((req, res) => res.status(404).json({
  success: false,
  code: 'ROUTE_NOT_FOUND',
  message: `Route ${req.method} ${req.originalUrl} not found`,
  requestId: req.id,
}));

/* ── Global Error Handler ── */
app.use(errorHandler);

module.exports = app;
