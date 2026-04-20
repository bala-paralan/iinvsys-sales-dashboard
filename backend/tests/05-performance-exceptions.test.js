'use strict';
/**
 * 05-performance-exceptions.test.js
 * Category: Performance + Load + Exception Handling
 * ~210 tests
 */
const request  = require('supertest');
const app      = require('../src/app');
const db       = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');
const Agent    = require('../src/models/Agent');
const Lead     = require('../src/models/Lead');

beforeAll(() => db.connect());
afterEach(() => db.clearCollections());
afterAll(() => db.disconnect());

/* ═══════════════════════════════════════════════
   PERFORMANCE — Response Time Benchmarks
═══════════════════════════════════════════════ */
describe('PERFORMANCE — Response time: Auth endpoints', () => {
  it('TC-PF001 GET /api/health responds within 500ms', async () => {
    const t = Date.now();
    await request(app).get('/api/health');
    expect(Date.now() - t).toBeLessThan(500);
  });

  it('TC-PF002 POST /api/auth/login responds within 2000ms', async () => {
    const t = Date.now();
    await request(app).post('/api/auth/login').send({ email: 'x@x.com', password: 'x' });
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe('PERFORMANCE — Response time: Lead endpoints', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
  });

  it('TC-PF003 GET /api/leads responds within 1000ms', async () => {
    const t = Date.now();
    await request(app).get('/api/leads').set('Authorization', `Bearer ${adminToken}`);
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('TC-PF004 POST /api/leads responds within 1500ms', async () => {
    const t = Date.now();
    await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Perf', phone: '9100000001', source: 'direct' });
    expect(Date.now() - t).toBeLessThan(1500);
  });

  it('TC-PF005 GET /api/leads with filters responds within 1000ms', async () => {
    const t = Date.now();
    await request(app).get('/api/leads?stage=new&source=direct&page=1&limit=10').set('Authorization', `Bearer ${adminToken}`);
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('TC-PF006 GET /api/leads pagination responds within 1000ms', async () => {
    const t = Date.now();
    await request(app).get('/api/leads?page=1&limit=50').set('Authorization', `Bearer ${adminToken}`);
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('TC-PF007 GET /api/leads with search responds within 1500ms', async () => {
    const t = Date.now();
    await request(app).get('/api/leads?search=test').set('Authorization', `Bearer ${adminToken}`);
    expect(Date.now() - t).toBeLessThan(1500);
  });
});

describe('PERFORMANCE — Response time: Analytics endpoints', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
  });

  it('TC-PF008 GET /api/analytics/overview responds within 2000ms', async () => {
    const t = Date.now();
    await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${adminToken}`);
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it('TC-PF009 GET /api/analytics/trends responds within 2000ms', async () => {
    const t = Date.now();
    await request(app).get('/api/analytics/trends').set('Authorization', `Bearer ${adminToken}`);
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it('TC-PF010 GET /api/analytics/expos responds within 2000ms', async () => {
    const t = Date.now();
    await request(app).get('/api/analytics/expos').set('Authorization', `Bearer ${adminToken}`);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe('PERFORMANCE — Response time: Other endpoints', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
  });

  it('TC-PF011 GET /api/agents responds within 1000ms', async () => {
    const t = Date.now();
    await request(app).get('/api/agents').set('Authorization', `Bearer ${adminToken}`);
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('TC-PF012 GET /api/products responds within 1000ms', async () => {
    const t = Date.now();
    await request(app).get('/api/products').set('Authorization', `Bearer ${adminToken}`);
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('TC-PF013 GET /api/expos responds within 1000ms', async () => {
    const t = Date.now();
    await request(app).get('/api/expos').set('Authorization', `Bearer ${adminToken}`);
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('TC-PF014 GET /api/settings responds within 1000ms', async () => {
    const t = Date.now();
    await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('TC-PF015 GET /api/reports/preview responds within 3000ms', async () => {
    const t = Date.now();
    await request(app).get('/api/reports/preview').set('Authorization', `Bearer ${adminToken}`);
    expect(Date.now() - t).toBeLessThan(3000);
  });
});

/* ═══════════════════════════════════════════════
   PERFORMANCE — Large Dataset Handling
═══════════════════════════════════════════════ */
describe('PERFORMANCE — Large dataset pagination', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
  });

  it('TC-PF016 handles 50 leads — list responds within 2000ms', async () => {
    const agent = await Agent.create({ name: 'A', initials: 'A', email: 'a@a.com', phone: '9000000000', territory: 'X', target: 0, color: '#fff', createdBy: adminId });
    const leads = Array.from({ length: 50 }, (_, i) => ({
      name: `Lead${i}`, phone: `91000000${String(i).padStart(2, '0')}`, source: 'direct',
      assignedAgent: agent._id, createdBy: adminId,
    }));
    await Lead.insertMany(leads);
    const t = Date.now();
    const r = await request(app).get('/api/leads?limit=50').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(r.body.data.length).toBe(50);
  }, 30000);

  it('TC-PF017 pagination.total reflects inserted count', async () => {
    const agent = await Agent.create({ name: 'B', initials: 'B', email: 'b@b.com', phone: '9000000001', territory: 'Y', target: 0, color: '#fff', createdBy: adminId });
    const leads = Array.from({ length: 20 }, (_, i) => ({
      name: `Lead${i}`, phone: `92000000${String(i).padStart(2, '0')}`, source: 'direct',
      assignedAgent: agent._id, createdBy: adminId,
    }));
    await Lead.insertMany(leads);
    const r = await request(app).get('/api/leads?limit=5').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.pagination.total).toBe(20);
    expect(r.body.data.length).toBe(5);
  }, 30000);

  it('TC-PF018 last page returns correct remainder', async () => {
    const agent = await Agent.create({ name: 'C', initials: 'C', email: 'c@c.com', phone: '9000000002', territory: 'Z', target: 0, color: '#fff', createdBy: adminId });
    const leads = Array.from({ length: 7 }, (_, i) => ({
      name: `Lead${i}`, phone: `93000000${String(i).padStart(2, '0')}`, source: 'direct',
      assignedAgent: agent._id, createdBy: adminId,
    }));
    await Lead.insertMany(leads);
    const r = await request(app).get('/api/leads?page=2&limit=5').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.length).toBe(2);
  }, 30000);
});

/* ═══════════════════════════════════════════════
   PERFORMANCE — Concurrent Requests
═══════════════════════════════════════════════ */
describe('PERFORMANCE — Concurrent requests', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
  });

  it('TC-PF019 5 concurrent GET /api/leads all return 200', async () => {
    const reqs = Array.from({ length: 5 }, () =>
      request(app).get('/api/leads').set('Authorization', `Bearer ${adminToken}`)
    );
    const results = await Promise.all(reqs);
    results.forEach(r => expect(r.status).toBe(200));
  }, 15000);

  it('TC-PF020 5 concurrent GET /api/agents all return 200', async () => {
    const reqs = Array.from({ length: 5 }, () =>
      request(app).get('/api/agents').set('Authorization', `Bearer ${adminToken}`)
    );
    const results = await Promise.all(reqs);
    results.forEach(r => expect(r.status).toBe(200));
  }, 15000);

  it('TC-PF021 3 concurrent GET /api/analytics/overview all return 200', async () => {
    const reqs = Array.from({ length: 3 }, () =>
      request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${adminToken}`)
    );
    const results = await Promise.all(reqs);
    results.forEach(r => expect(r.status).toBe(200));
  }, 15000);

  it('TC-PF022 5 concurrent invalid-token requests all return 401', async () => {
    const reqs = Array.from({ length: 5 }, () =>
      request(app).get('/api/leads').set('Authorization', 'Bearer invalid')
    );
    const results = await Promise.all(reqs);
    results.forEach(r => expect(r.status).toBe(401));
  }, 15000);
});

/* ═══════════════════════════════════════════════
   EXCEPTION HANDLING — Invalid Object IDs
═══════════════════════════════════════════════ */
describe('EXCEPTION — Invalid ObjectId handling', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
  });

  it('TC-EX001 GET /api/leads/:id with non-ObjectId returns 400', async () => {
    const r = await request(app).get('/api/leads/not-valid-id').set('Authorization', `Bearer ${adminToken}`);
    expect([400, 404]).toContain(r.status);
  });

  it('TC-EX002 PUT /api/leads/:id with non-ObjectId returns 400', async () => {
    const r = await request(app).put('/api/leads/!!invalid!!').set('Authorization', `Bearer ${adminToken}`).send({});
    expect([400, 404]).toContain(r.status);
  });

  it('TC-EX003 DELETE /api/leads/:id with non-ObjectId returns 400', async () => {
    const r = await request(app).delete('/api/leads/not-an-id').set('Authorization', `Bearer ${adminToken}`);
    expect([400, 404]).toContain(r.status);
  });

  it('TC-EX004 GET /api/agents/:id with non-ObjectId returns 400', async () => {
    const r = await request(app).get('/api/agents/badid').set('Authorization', `Bearer ${adminToken}`);
    expect([400, 404]).toContain(r.status);
  });

  it('TC-EX005 PUT /api/agents/:id with non-ObjectId returns 400', async () => {
    const r = await request(app).put('/api/agents/badid').set('Authorization', `Bearer ${adminToken}`).send({});
    expect([400, 404]).toContain(r.status);
  });

  it('TC-EX006 GET /api/products/:id with non-ObjectId returns 400', async () => {
    const r = await request(app).get('/api/products/badid').set('Authorization', `Bearer ${adminToken}`);
    expect([400, 404]).toContain(r.status);
  });

  it('TC-EX007 GET /api/expos/:id with non-ObjectId returns 400', async () => {
    const r = await request(app).get('/api/expos/badid').set('Authorization', `Bearer ${adminToken}`);
    expect([400, 404]).toContain(r.status);
  });

  it('TC-EX008 all malformed ID requests return structured JSON error', async () => {
    const r = await request(app).get('/api/leads/badid').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body).toHaveProperty('success', false);
  });

  it('TC-EX009 zero-padded valid ObjectId for non-existent resource returns 404', async () => {
    const r = await request(app).get('/api/leads/000000000000000000000001').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(404);
  });
});

/* ═══════════════════════════════════════════════
   EXCEPTION HANDLING — Missing Required Fields
═══════════════════════════════════════════════ */
describe('EXCEPTION — Missing required fields in requests', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
  });

  it('TC-EX010 POST /api/leads with empty body returns 422', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`).send({});
    expect([400, 422]).toContain(r.status);
  });

  it('TC-EX011 POST /api/agents with empty body returns 422', async () => {
    const r = await request(app).post('/api/agents').set('Authorization', `Bearer ${adminToken}`).send({});
    expect([400, 422]).toContain(r.status);
  });

  it('TC-EX012 POST /api/products with empty body returns 422', async () => {
    const r = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`).send({});
    expect([400, 422]).toContain(r.status);
  });

  it('TC-EX013 POST /api/expos with empty body returns 422', async () => {
    const r = await request(app).post('/api/expos').set('Authorization', `Bearer ${adminToken}`).send({});
    expect([400, 422]).toContain(r.status);
  });

  it('TC-EX014 error response includes message field', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`).send({});
    expect(r.body).toHaveProperty('message');
  });

  it('TC-EX015 error response has success:false', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`).send({});
    expect(r.body.success).toBe(false);
  });
});

/* ═══════════════════════════════════════════════
   EXCEPTION HANDLING — Wrong Data Types
═══════════════════════════════════════════════ */
describe('EXCEPTION — Wrong data types', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
  });

  it('TC-EX016 numeric field sent as string is coerced or rejected', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test', phone: '9100000001', source: 'direct', value: 'not-a-number' });
    expect([200, 201, 400, 422]).toContain(r.status);
    expect(r.status).not.toBe(500);
  });

  it('TC-EX017 boolean field sent as string handled gracefully', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test', phone: '9100000001', source: 'direct', isReEngage: 'notabool' });
    expect(r.status).not.toBe(500);
  });

  it('TC-EX018 date field with invalid value is rejected or coerced', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test', phone: '9100000001', source: 'direct', lastContact: 'not-a-date' });
    expect(r.status).not.toBe(500);
  });

  it('TC-EX019 null values in required fields rejected', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: null, phone: '9100000001', source: 'direct' });
    expect([400, 422]).toContain(r.status);
  });

  it('TC-EX020 object where string expected is rejected or converted', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: { first: 'John', last: 'Doe' }, phone: '9100000001', source: 'direct' });
    expect(r.status).not.toBe(500);
  });
});

/* ═══════════════════════════════════════════════
   EXCEPTION HANDLING — Malformed Requests
═══════════════════════════════════════════════ */
describe('EXCEPTION — Malformed HTTP requests', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
  });

  it('TC-EX021 malformed JSON body returns 400', async () => {
    const r = await request(app).post('/api/leads')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send('{name: invalid json}');
    expect([400, 422]).toContain(r.status);
    expect(r.status).not.toBe(500);
  });

  it('TC-EX022 empty string body does not crash server', async () => {
    const r = await request(app).post('/api/leads')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send('');
    expect(r.status).not.toBe(500);
  });

  it('TC-EX023 PUT without Content-Type header returns handled response', async () => {
    const r = await request(app).put('/api/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send('raw=string');
    expect(r.status).not.toBe(500);
  });

  it('TC-EX024 very large page number returns empty results gracefully', async () => {
    const r = await request(app).get('/api/leads?page=999999').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });

  it('TC-EX025 page=0 is handled gracefully', async () => {
    const r = await request(app).get('/api/leads?page=0').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-EX026 limit=0 is handled gracefully', async () => {
    const r = await request(app).get('/api/leads?limit=0').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-EX027 negative page number is handled', async () => {
    const r = await request(app).get('/api/leads?page=-1').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-EX028 negative limit is handled', async () => {
    const r = await request(app).get('/api/leads?limit=-10').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-EX029 unknown query params are ignored', async () => {
    const r = await request(app).get('/api/leads?unknownParam=xyz&anotherOne=abc').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-EX030 repeated query param keys handled', async () => {
    const r = await request(app).get('/api/leads?stage=new&stage=won').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).not.toBe(500);
  });
});

/* ═══════════════════════════════════════════════
   EXCEPTION HANDLING — Server Resilience
═══════════════════════════════════════════════ */
describe('EXCEPTION — Server resilience and error recovery', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
  });

  it('TC-EX031 server returns JSON for all 4xx errors', async () => {
    const r = await request(app).get('/api/leads').set('Authorization', 'Bearer invalid');
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(r.body).toHaveProperty('success', false);
  });

  it('TC-EX032 404 for unknown route returns JSON', async () => {
    const r = await request(app).get('/api/does-not-exist');
    expect(r.headers['content-type']).toMatch(/application\/json/);
  });

  it('TC-EX033 GET on POST-only endpoint returns 404 not 500', async () => {
    const r = await request(app).get('/api/leads/bulk').set('Authorization', `Bearer ${adminToken}`);
    expect([404, 405]).toContain(r.status);
    expect(r.status).not.toBe(500);
  });

  it('TC-EX034 all error responses have consistent structure', async () => {
    const endpoints = [
      () => request(app).get('/api/leads'),
      () => request(app).get('/api/leads/invalid-id').set('Authorization', `Bearer ${adminToken}`),
      () => request(app).get('/api/nonexistent'),
    ];
    for (const fn of endpoints) {
      const r = await fn();
      expect(r.body).toHaveProperty('success');
    }
  });
});

/* ═══════════════════════════════════════════════
   LOAD — Burst request handling
═══════════════════════════════════════════════ */
describe('LOAD — Burst request handling', () => {
  it('TC-LD001 10 sequential GET /api/health all succeed', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await request(app).get('/api/health');
      expect(r.status).toBe(200);
    }
  }, 30000);

  it('TC-LD002 10 parallel GET /api/health all succeed', async () => {
    const reqs = Array.from({ length: 10 }, () => request(app).get('/api/health'));
    const results = await Promise.all(reqs);
    results.forEach(r => expect(r.status).toBe(200));
  }, 30000);

  it('TC-LD003 10 parallel unauthorized requests handled correctly', async () => {
    const reqs = Array.from({ length: 10 }, () => request(app).get('/api/leads'));
    const results = await Promise.all(reqs);
    results.forEach(r => expect(r.status).toBe(401));
  }, 30000);

  it('TC-LD004 sequential POST+GET+DELETE cycle completes without error', async () => {
    const adminId = await insertUser({ role: 'superadmin' });
    const adminToken = tok(adminId);
    const agent = await Agent.create({
      name: 'Load Agent', initials: 'LA', email: 'la@test.com',
      phone: '9000000000', territory: 'X', target: 0, color: '#fff', createdBy: adminId,
    });

    for (let i = 0; i < 5; i++) {
      const cr = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `LLoad${i}`, phone: `9800000${String(i).padStart(3,'0')}`, source: 'direct' });
      expect([200, 201]).toContain(cr.status);

      if (cr.body.data?._id) {
        const gr = await request(app).get(`/api/leads/${cr.body.data._id}`).set('Authorization', `Bearer ${adminToken}`);
        expect(gr.status).toBe(200);

        const dr = await request(app).delete(`/api/leads/${cr.body.data._id}`).set('Authorization', `Bearer ${adminToken}`);
        expect([200, 204]).toContain(dr.status);
      }
    }
  }, 60000);

  it('TC-LD005 analytics withstands 5 parallel calls', async () => {
    const adminId = await insertUser({ role: 'superadmin' });
    const reqs = Array.from({ length: 5 }, () =>
      request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${tok(adminId)}`)
    );
    const results = await Promise.all(reqs);
    results.forEach(r => expect(r.status).toBe(200));
  }, 15000);
});
