'use strict';
/**
 * R-6 platform requirements: N-3 (request ids + structured logging) and
 * N-4 (environment validated at boot, readiness separate from liveness).
 *
 * The bug these defend against is not a crash — it is an app that LOOKS fine.
 * With no JWT_SECRET the process started, `/api/health` said "healthy",
 * monitoring stayed green, and every login returned 500.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const { checkEnv, assertEnv, MIN_SECRET_LENGTH } = require('../src/config/env');
const { safeQuery } = require('../src/middleware/requestContext');
const { connect, disconnect, clearCollections } = require('./helpers/db');

beforeAll(connect);
afterAll(async () => { await clearCollections(); await disconnect(); });

/* ══════════════════════════════════════════════════════════════════════════
   N-4 — environment validated at boot
   ══════════════════════════════════════════════════════════════════════════ */

describe('environment validation', () => {
  const withEnv = (patch, fn) => {
    const saved = { ...process.env };
    Object.assign(process.env, patch);
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete process.env[k];
    try { return fn(); } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  };

  it('accepts the current test environment', () => {
    expect(checkEnv().errors).toEqual([]);
  });

  it('rejects a missing JWT_SECRET — the failure that looked healthy', () => {
    withEnv({ JWT_SECRET: undefined }, () => {
      expect(checkEnv().errors).toContain('JWT_SECRET is not set');
    });
  });

  it('rejects a missing MONGO_URI', () => {
    withEnv({ MONGO_URI: undefined }, () => {
      expect(checkEnv().errors).toContain('MONGO_URI is not set');
    });
  });

  it('is stricter in production: short secrets, defaults, and blank CORS', () => {
    withEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'short',
      ADMIN_PASSWORD: 'Admin@123',
      CORS_ORIGINS: '',
    }, () => {
      const { errors } = checkEnv();
      expect(errors).toContain(`JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters`);
      expect(errors).toContain('ADMIN_PASSWORD is set to a well-known default value');
      /* Blank CORS_ORIGINS makes app.js fall back to '*' WITH credentials —
         the docker-compose default, and a cross-origin credential leak. */
      expect(errors.some((e) => e.startsWith('CORS_ORIGINS is not set'))).toBe(true);
    });
  });

  it('refuses the local file driver on Vercel, whose disk is ephemeral', () => {
    withEnv({
      NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40),
      CORS_ORIGINS: 'https://sales.iinvsys.com',
      FILE_STORE_DRIVER: 'local', VERCEL: '1',
    }, () => {
      expect(checkEnv().errors.some((e) => e.includes('Vercel'))).toBe(true);
    });
  });

  it('warns about the RATE_LIMIT / RATE_LIMIT_MAX name mismatch', () => {
    /* .env.example documented one name and app.js read the other, so raising
       the limit in production silently did nothing. */
    withEnv({ RATE_LIMIT: '500', RATE_LIMIT_MAX: undefined }, () => {
      expect(checkEnv().warnings.some((w) => w.includes('RATE_LIMIT_MAX'))).toBe(true);
    });
  });

  it('throws rather than exiting when asked to, and names every problem at once', () => {
    withEnv({ JWT_SECRET: undefined, MONGO_URI: undefined }, () => {
      /* One boot, one complete list — not a fix-and-redeploy loop. */
      expect(() => assertEnv({ exit: false })).toThrow(/JWT_SECRET is not set[\s\S]*MONGO_URI is not set/);
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   N-3 — request ids
   ══════════════════════════════════════════════════════════════════════════ */

describe('request ids', () => {
  it('puts an id on every response', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-request-id']).toMatch(/^[\w-]{8,64}$/);
  });

  it('gives different requests different ids', async () => {
    const a = await request(app).get('/api/health');
    const b = await request(app).get('/api/health');
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });

  it('adopts a well-formed upstream id so a trace survives the proxy hop', async () => {
    const res = await request(app).get('/api/health').set('X-Request-Id', 'edge-abc-123456');
    expect(res.headers['x-request-id']).toBe('edge-abc-123456');
  });

  it('ignores a malformed or oversized upstream id', async () => {
    /* An unbounded client-supplied string would otherwise land in every log
       line for that request. */
    const res = await request(app).get('/api/health').set('X-Request-Id', 'x'.repeat(500));
    expect(res.headers['x-request-id']).not.toBe('x'.repeat(500));

    const bad = await request(app).get('/api/health').set('X-Request-Id', 'has spaces');
    expect(bad.headers['x-request-id']).not.toBe('has spaces');
  });

  it('redacts secrets from the logged query string', () => {
    expect(safeQuery({ page: '2', token: 'abc', password: 'hunter2' }))
      .toEqual({ page: '2', token: '[redacted]', password: '[redacted]' });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Liveness vs readiness
   ══════════════════════════════════════════════════════════════════════════ */

describe('GET /api/health and /api/ready', () => {
  it('health answers without touching the database', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  it('ready reports the database check', async () => {
    const res = await request(app).get('/api/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: 'ready' });
    expect(res.body.checks.database).toMatchObject({ ok: true, state: 'connected' });
  });

  it('ready answers 503 when the database is not connected', async () => {
    /* The distinction that matters: an instance that cannot serve should be
       drained from the load balancer, not killed and restarted — and the old
       single endpoint reported "healthy" with Mongo unreachable. */
    /* readyState is an accessor on the prototype. Shadow it with an own
       property and DELETE that afterwards — redefining it as a data property
       and restoring the value leaves it non-writable, and mongoose's own
       disconnect() then throws while assigning to it. */
    const hadOwn = Object.prototype.hasOwnProperty.call(mongoose.connection, 'readyState');
    Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });
    try {
      const res = await request(app).get('/api/ready');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ success: false, status: 'not-ready' });
      expect(res.body.checks.database).toMatchObject({ ok: false, state: 'disconnected' });

      /* Liveness is unaffected — the process is fine. */
      expect((await request(app).get('/api/health')).status).toBe(200);
    } finally {
      delete mongoose.connection.readyState;
      expect(hadOwn).toBe(false);
      expect(mongoose.connection.readyState).toBe(1);   // the real accessor is back
    }
  });

  it('neither endpoint requires authentication', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/api/ready')).status).toBe(200);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Errors carry the id
   ══════════════════════════════════════════════════════════════════════════ */

describe('error responses', () => {
  it('a 404 still carries a request id header', async () => {
    const res = await request(app).get('/api/no-such-route');
    expect(res.status).toBe(404);
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   N-7 / N-8 / N-12 — headers, envelope, retention
   ══════════════════════════════════════════════════════════════════════════ */

describe('security headers (N-7)', () => {
  it('sets a CSP that does not allow inline scripts', async () => {
    const res = await request(app).get('/api/health');
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeTruthy();

    /* The single most important assertion in this file: an XSS payload in a
       lead name is inert only if inline script is refused. */
    const scriptSrc = /script-src ([^;]+)/.exec(csp)[1];
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).toContain("'self'");
  });

  it('forbids framing and plugin content', async () => {
    const csp = (await request(app).get('/api/health')).headers['content-security-policy'];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it('allows blob: images — the authenticated xlsx download needs it', async () => {
    const csp = (await request(app).get('/api/health')).headers['content-security-policy'];
    expect(/img-src [^;]*blob:/.test(csp)).toBe(true);
  });
});

describe('response envelope (N-8)', () => {
  it('a 404 answers {success, code, message}, not {success, error}', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    /* The client reads `message`. Answering under `error` meant a user saw
       "Request failed (404)" while the real text sat in a key nothing read. */
    expect(res.body.message).toMatch(/not found/i);
    expect(res.body.code).toBe('ROUTE_NOT_FOUND');
    expect(res.body.error).toBeUndefined();
    expect(res.body.requestId).toBeTruthy();
  });
});

describe('retention (N-12)', () => {
  it('Telemetry has a TTL index', async () => {
    const Telemetry = require('../src/models/Telemetry');
    await Telemetry.init();
    const indexes = await Telemetry.collection.indexes();
    const ttl = indexes.find((i) => i.expireAfterSeconds !== undefined);
    /* Without this the collection grows without bound and is the one most
       likely to fill the disk — VoiceMemo already had a TTL; this did not. */
    expect(ttl).toBeTruthy();
    expect(ttl.key).toHaveProperty('timestampUtc');
    expect(ttl.expireAfterSeconds).toBe(Telemetry.RETENTION_DAYS * 86400);
  });
});
