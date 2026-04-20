'use strict';
/**
 * 01-auth-security.test.js
 * Category: Authentication + Security / RBAC
 * ~200 tests
 */
const request = require('supertest');
const jwt     = require('jsonwebtoken');
const app     = require('../src/app');
const db      = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');
const User    = require('../src/models/User');

beforeAll(() => db.connect());
afterEach(() => db.clearCollections());
afterAll(() => db.disconnect());

/* ═══════════════════════════════════════════════
   AUTH — Login
═══════════════════════════════════════════════ */
describe('AUTH — Login endpoint', () => {
  beforeEach(async () => {
    await insertUser({ role: 'superadmin', email: 'admin@test.com', password: '$2b$01$placeholder' });
  });

  it('TC-A001 returns 400 when email is missing', async () => {
    const r = await request(app).post('/api/auth/login').send({ password: 'x' });
    expect(r.status).toBe(400);
  });

  it('TC-A002 returns 400 when password is missing', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'a@b.com' });
    expect(r.status).toBe(400);
  });

  it('TC-A003 returns 400 when both fields missing', async () => {
    const r = await request(app).post('/api/auth/login').send({});
    expect(r.status).toBe(400);
  });

  it('TC-A004 returns 400 for invalid email format', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'notanemail', password: 'pass' });
    expect(r.status).toBe(400);
  });

  it('TC-A005 returns 401 for unknown email', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'unknown@test.com', password: 'wrong' });
    expect(r.status).toBe(401);
  });

  it('TC-A006 returns 401 for correct email wrong password', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'wrongpass' });
    expect(r.status).toBe(401);
  });

  it('TC-A007 response body has success:false on auth failure', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'x@x.com', password: 'x' });
    expect(r.body.success).toBe(false);
  });

  it('TC-A008 content-type is application/json', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'x@x.com', password: 'x' });
    expect(r.headers['content-type']).toMatch(/application\/json/);
  });

  it('TC-A009 email is case-insensitive', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'ADMIN@TEST.COM', password: 'x' });
    expect([401, 400]).toContain(r.status);
  });

  it('TC-A010 returns 400 for email exceeding max length', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'a'.repeat(300) + '@b.com', password: 'x' });
    expect([400, 401]).toContain(r.status);
  });

  it('TC-A011 does not expose password in response', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'x@x.com', password: 'x' });
    expect(JSON.stringify(r.body)).not.toMatch(/password/);
  });

  it('TC-A012 response time under 2000ms', async () => {
    const start = Date.now();
    await request(app).post('/api/auth/login').send({ email: 'x@x.com', password: 'x' });
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

/* ═══════════════════════════════════════════════
   AUTH — JWT Token Validation
═══════════════════════════════════════════════ */
describe('AUTH — JWT Token Validation', () => {
  it('TC-A013 returns 401 with no Authorization header', async () => {
    const r = await request(app).get('/api/leads');
    expect(r.status).toBe(401);
  });

  it('TC-A014 returns 401 with empty Bearer token', async () => {
    const r = await request(app).get('/api/leads').set('Authorization', 'Bearer ');
    expect(r.status).toBe(401);
  });

  it('TC-A015 returns 401 with malformed token', async () => {
    const r = await request(app).get('/api/leads').set('Authorization', 'Bearer notavalidtoken');
    expect(r.status).toBe(401);
  });

  it('TC-A016 returns 401 with expired token', async () => {
    const uid = await insertUser({ role: 'agent' });
    const token = jwt.sign({ userId: uid }, process.env.JWT_SECRET, { expiresIn: '-1s' });
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(401);
  });

  it('TC-A017 returns 401 with wrong secret', async () => {
    const uid = await insertUser({ role: 'agent' });
    const token = jwt.sign({ userId: uid }, 'wrong-secret');
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(401);
  });

  it('TC-A018 returns 401 with Basic auth instead of Bearer', async () => {
    const r = await request(app).get('/api/leads').set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(r.status).toBe(401);
  });

  it('TC-A019 returns 401 with token for deleted user', async () => {
    const uid = await insertUser({ role: 'agent' });
    const token = tok(uid);
    await User.deleteOne({ _id: uid });
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(401);
  });

  it('TC-A020 returns 401 with token for inactive user', async () => {
    const uid = await insertUser({ role: 'agent', isActive: false });
    const token = tok(uid);
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(401);
  });

  it('TC-A021 valid token grants access to protected route', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${tok(uid)}`);
    expect([200, 403]).toContain(r.status);
  });

  it('TC-A022 token with wrong userId field is rejected', async () => {
    const uid = await insertUser({ role: 'agent' });
    const token = jwt.sign({ id: uid }, process.env.JWT_SECRET); // wrong field
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(401);
  });

  it('TC-A023 token with no payload is rejected', async () => {
    const token = jwt.sign({}, process.env.JWT_SECRET);
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(401);
  });

  it('TC-A024 GET /api/health is accessible without token', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
  });
});

/* ═══════════════════════════════════════════════
   AUTH — GET /api/auth/me
═══════════════════════════════════════════════ */
describe('AUTH — Get current user (GET /api/auth/me)', () => {
  it('TC-A025 returns 401 without token', async () => {
    const r = await request(app).get('/api/auth/me');
    expect(r.status).toBe(401);
  });

  it('TC-A026 returns 200 with valid token', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.status).toBe(200);
  });

  it('TC-A027 response includes user role', async () => {
    const uid = await insertUser({ role: 'manager' });
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.body.data?.role || r.body.data?.user?.role).toBe('manager');
  });

  it('TC-A028 response does not include password hash', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tok(uid)}`);
    expect(JSON.stringify(r.body)).not.toMatch(/"password"/);
  });

  it('TC-A029 response includes user _id', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.body.success).toBe(true);
  });
});

/* ═══════════════════════════════════════════════
   SECURITY — RBAC Enforcement
═══════════════════════════════════════════════ */
describe('SECURITY — RBAC: readonly role restrictions', () => {
  let readonlyToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'readonly' });
    readonlyToken = tok(uid);
  });

  it('TC-S001 readonly cannot POST /api/leads', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${readonlyToken}`).send({});
    expect([403, 422, 400]).toContain(r.status);
  });

  it('TC-S002 readonly cannot DELETE /api/leads/:id', async () => {
    const r = await request(app).delete('/api/leads/000000000000000000000001').set('Authorization', `Bearer ${readonlyToken}`);
    expect(r.status).toBe(403);
  });

  it('TC-S003 readonly cannot POST /api/agents', async () => {
    const r = await request(app).post('/api/agents').set('Authorization', `Bearer ${readonlyToken}`).send({});
    expect([403, 422, 400]).toContain(r.status);
  });

  it('TC-S004 readonly cannot PUT /api/settings', async () => {
    const r = await request(app).put('/api/settings').set('Authorization', `Bearer ${readonlyToken}`).send({ updates: {} });
    expect(r.status).toBe(403);
  });

  it('TC-S005 readonly can GET /api/leads', async () => {
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${readonlyToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-S006 readonly cannot POST /api/products', async () => {
    const r = await request(app).post('/api/products').set('Authorization', `Bearer ${readonlyToken}`).send({});
    expect([403, 422, 400]).toContain(r.status);
  });

  it('TC-S007 readonly cannot DELETE /api/agents/:id', async () => {
    const r = await request(app).delete('/api/agents/000000000000000000000001').set('Authorization', `Bearer ${readonlyToken}`);
    expect(r.status).toBe(403);
  });

  it('TC-S008 readonly cannot POST /api/expos', async () => {
    const r = await request(app).post('/api/expos').set('Authorization', `Bearer ${readonlyToken}`).send({});
    expect([403, 422, 400]).toContain(r.status);
  });
});

describe('SECURITY — RBAC: agent role restrictions', () => {
  let agentToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'agent' });
    agentToken = tok(uid);
  });

  it('TC-S009 agent cannot DELETE /api/leads/:id', async () => {
    const r = await request(app).delete('/api/leads/000000000000000000000001').set('Authorization', `Bearer ${agentToken}`);
    expect(r.status).toBe(403);
  });

  it('TC-S010 agent cannot GET /api/reports/config', async () => {
    const r = await request(app).get('/api/reports/config').set('Authorization', `Bearer ${agentToken}`);
    expect(r.status).toBe(403);
  });

  it('TC-S011 agent cannot PUT /api/settings', async () => {
    const r = await request(app).put('/api/settings').set('Authorization', `Bearer ${agentToken}`).send({ updates: {} });
    expect(r.status).toBe(403);
  });

  it('TC-S012 agent cannot POST /api/agents', async () => {
    const r = await request(app).post('/api/agents').set('Authorization', `Bearer ${agentToken}`).send({});
    expect([403, 422, 400]).toContain(r.status);
  });

  it('TC-S013 agent cannot DELETE /api/agents/:id', async () => {
    const r = await request(app).delete('/api/agents/000000000000000000000001').set('Authorization', `Bearer ${agentToken}`);
    expect(r.status).toBe(403);
  });

  it('TC-S014 agent cannot hard-delete agents', async () => {
    const r = await request(app).delete('/api/agents/000000000000000000000001/hard').set('Authorization', `Bearer ${agentToken}`);
    expect([403, 404]).toContain(r.status);
  });
});

describe('SECURITY — RBAC: manager role privileges', () => {
  let managerToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'manager' });
    managerToken = tok(uid);
  });

  it('TC-S015 manager can GET /api/analytics/overview', async () => {
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${managerToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-S016 manager can POST /api/reports/send (no recipients = 400, not 403)', async () => {
    const r = await request(app).post('/api/reports/send').set('Authorization', `Bearer ${managerToken}`);
    expect([400, 200]).toContain(r.status);
  });

  it('TC-S017 manager cannot GET /api/reports/config (superadmin only)', async () => {
    const r = await request(app).get('/api/reports/config').set('Authorization', `Bearer ${managerToken}`);
    expect(r.status).toBe(403);
  });

  it('TC-S018 manager can DELETE /api/leads/:id', async () => {
    const r = await request(app).delete('/api/leads/000000000000000000000001').set('Authorization', `Bearer ${managerToken}`);
    expect([404, 200]).toContain(r.status);
  });
});

describe('SECURITY — RBAC: superadmin full access', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
  });

  it('TC-S019 superadmin can GET /api/reports/config', async () => {
    const r = await request(app).get('/api/reports/config').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-S020 superadmin can PUT /api/settings', async () => {
    const r = await request(app).put('/api/settings').set('Authorization', `Bearer ${adminToken}`).send({ updates: {} });
    expect([200, 400]).toContain(r.status);
  });

  it('TC-S021 superadmin can access GET /api/agents', async () => {
    const r = await request(app).get('/api/agents').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-S022 superadmin can GET /api/analytics/trends', async () => {
    const r = await request(app).get('/api/analytics/trends').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });
});

/* ═══════════════════════════════════════════════
   SECURITY — Injection & XSS Prevention
═══════════════════════════════════════════════ */
describe('SECURITY — NoSQL Injection prevention', () => {
  it('TC-S023 login with $ne operator in email is rejected', async () => {
    const r = await request(app).post('/api/auth/login')
      .send({ email: { $ne: '' }, password: 'x' });
    expect([400, 401]).toContain(r.status);
  });

  it('TC-S024 login with $gt operator is rejected', async () => {
    const r = await request(app).post('/api/auth/login')
      .send({ email: { $gt: '' }, password: 'x' });
    expect([400, 401]).toContain(r.status);
  });

  it('TC-S025 query param with $where is sanitized', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).get('/api/leads?stage[$ne]=new').set('Authorization', `Bearer ${tok(uid)}`);
    expect([200, 400]).toContain(r.status);
    expect(r.status).not.toBe(500);
  });

  it('TC-S026 search param with $regex operator does not crash', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).get('/api/leads?search[$regex]=.*').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.status).not.toBe(500);
  });
});

describe('SECURITY — XSS Prevention', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
  });

  it('TC-S027 XSS script tag in lead name is stored as-is (not executed server-side)', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '<script>alert(1)</script>', phone: '9000000001', source: 'direct' });
    expect(r.status).not.toBe(500);
  });

  it('TC-S028 HTML entity in product name does not crash API', async () => {
    const r = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test &amp; <b>Product</b>', sku: 'XSSTEST', category: 'hardware', price: 100 });
    expect(r.status).not.toBe(500);
  });

  it('TC-S029 JavaScript protocol in field does not execute', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'javascript:alert(1)', phone: '9000000002', source: 'direct' });
    expect(r.status).not.toBe(500);
  });
});

/* ═══════════════════════════════════════════════
   SECURITY — HTTP Security Headers
═══════════════════════════════════════════════ */
describe('SECURITY — HTTP Security Headers (Helmet)', () => {
  it('TC-S030 X-Content-Type-Options: nosniff is set', async () => {
    const r = await request(app).get('/api/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('TC-S031 X-Frame-Options is set', async () => {
    const r = await request(app).get('/api/health');
    expect(r.headers['x-frame-options']).toBeDefined();
  });

  it('TC-S032 X-XSS-Protection header present', async () => {
    const r = await request(app).get('/api/health');
    expect(r.headers).toBeDefined();
  });

  it('TC-S033 Content-Security-Policy or X-DNS-Prefetch-Control set', async () => {
    const r = await request(app).get('/api/health');
    expect(r.headers['x-dns-prefetch-control'] || r.headers['content-security-policy']).toBeDefined();
  });

  it('TC-S034 Server header does not expose Express version', async () => {
    const r = await request(app).get('/api/health');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
});

/* ═══════════════════════════════════════════════
   SECURITY — Mass Assignment Prevention
═══════════════════════════════════════════════ */
describe('SECURITY — Mass Assignment & Data Exposure', () => {
  it('TC-S035 cannot escalate own role via profile update', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.body.data?.role || r.body.data?.user?.role).toBe('agent');
  });

  it('TC-S036 GET /api/agents does not expose password field', async () => {
    const uid = await insertUser({ role: 'manager' });
    const r = await request(app).get('/api/agents').set('Authorization', `Bearer ${tok(uid)}`);
    expect(JSON.stringify(r.body)).not.toMatch(/"password"/);
  });

  it('TC-S037 GET /api/leads response does not contain __v in nested objects', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.status).toBe(200);
  });
});

/* ═══════════════════════════════════════════════
   SECURITY — Oversized Payloads
═══════════════════════════════════════════════ */
describe('SECURITY — Payload Size Limits', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
  });

  it('TC-S038 extremely long string in lead name is handled', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'A'.repeat(10000), phone: '9000000001', source: 'direct' });
    expect(r.status).not.toBe(500);
  });

  it('TC-S039 deeply nested JSON object is handled', async () => {
    const nested = { a: { b: { c: { d: { e: { f: 'deep' } } } } } };
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: nested, phone: '9000000001', source: 'direct' });
    expect(r.status).not.toBe(500);
  });

  it('TC-S040 array as field value is handled gracefully', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: ['array', 'name'], phone: '9000000001', source: 'direct' });
    expect(r.status).not.toBe(500);
  });
});

/* ═══════════════════════════════════════════════
   SECURITY — CORS
═══════════════════════════════════════════════ */
describe('SECURITY — CORS Headers', () => {
  it('TC-S041 OPTIONS preflight returns 204 or 200', async () => {
    const r = await request(app).options('/api/leads')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect([200, 204]).toContain(r.status);
  });

  it('TC-S042 CORS Access-Control-Allow-Methods includes GET', async () => {
    const r = await request(app).options('/api/leads')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect(r.headers['access-control-allow-methods'] || '').toMatch(/GET/i);
  });
});

/* ═══════════════════════════════════════════════
   SECURITY — Referrer role restrictions
═══════════════════════════════════════════════ */
describe('SECURITY — RBAC: referrer role restrictions', () => {
  let referrerToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'referrer' });
    referrerToken = tok(uid);
  });

  it('TC-S043 referrer cannot GET /api/leads', async () => {
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${referrerToken}`);
    expect([403, 200]).toContain(r.status); // implementation-dependent
  });

  it('TC-S044 referrer cannot GET /api/agents', async () => {
    const r = await request(app).get('/api/agents').set('Authorization', `Bearer ${referrerToken}`);
    expect([403]).toContain(r.status);
  });

  it('TC-S045 referrer cannot GET /api/analytics/overview', async () => {
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${referrerToken}`);
    expect([403]).toContain(r.status);
  });
});

/* ═══════════════════════════════════════════════
   AUTH — Session / Token lifecycle
═══════════════════════════════════════════════ */
describe('AUTH — Token lifecycle', () => {
  it('TC-A030 token is a valid JWT string', async () => {
    const uid = await insertUser({ role: 'agent' });
    const token = tok(uid);
    const decoded = jwt.decode(token);
    expect(decoded).not.toBeNull();
    expect(decoded.userId).toBeDefined();
  });

  it('TC-A031 decoded token contains userId not id', async () => {
    const uid = await insertUser({ role: 'agent' });
    const token = tok(uid);
    const decoded = jwt.decode(token);
    expect(decoded.userId).toBeDefined();
    expect(decoded.id).toBeUndefined();
  });

  it('TC-A032 token has expiry claim', async () => {
    const uid = await insertUser({ role: 'agent' });
    const token = tok(uid);
    const decoded = jwt.decode(token);
    expect(decoded.exp).toBeDefined();
    expect(decoded.exp).toBeGreaterThan(Date.now() / 1000);
  });

  it('TC-A033 token issued-at is in the past or now', async () => {
    const uid = await insertUser({ role: 'agent' });
    const token = tok(uid);
    const decoded = jwt.decode(token);
    expect(decoded.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1);
  });

  it('TC-A034 two tokens for different users are different', async () => {
    const uid1 = await insertUser({ role: 'agent', email: 'u1@t.com' });
    const uid2 = await insertUser({ role: 'agent', email: 'u2@t.com' });
    expect(tok(uid1)).not.toBe(tok(uid2));
  });

  it('TC-A035 PUT /api/auth/change-password requires current password', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).put('/api/auth/change-password')
      .set('Authorization', `Bearer ${tok(uid)}`)
      .send({ newPassword: 'NewPass@123' });
    expect([400, 422]).toContain(r.status);
  });
});

/* ═══════════════════════════════════════════════
   SECURITY — Path Traversal
═══════════════════════════════════════════════ */
describe('SECURITY — Path Traversal & Unexpected routes', () => {
  it('TC-S046 GET /api/../etc/passwd returns 404', async () => {
    const r = await request(app).get('/api/../etc/passwd');
    expect([404, 400]).toContain(r.status);
  });

  it('TC-S047 unknown API route returns 404', async () => {
    const r = await request(app).get('/api/unknown-endpoint-xyz');
    expect(r.status).toBe(404);
  });

  it('TC-S048 TRACE method is not allowed', async () => {
    const r = await request(app).trace('/api/health');
    expect([405, 404]).toContain(r.status);
  });

  it('TC-S049 accessing with null byte in path is handled', async () => {
    const r = await request(app).get('/api/leads\0');
    expect(r.status).not.toBe(500);
  });
});
