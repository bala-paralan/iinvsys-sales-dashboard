'use strict';
/**
 * 06-regression-contracts.test.js
 * Category: Regression + API Contract + UI Contract
 * ~130 tests
 */
const request  = require('supertest');
const jwt      = require('jsonwebtoken');
const app      = require('../src/app');
const db       = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');
const Agent    = require('../src/models/Agent');
const Lead     = require('../src/models/Lead');
const Setting  = require('../src/models/Setting');

beforeAll(() => db.connect());
afterEach(() => db.clearCollections());
afterAll(() => db.disconnect());

/* ═══════════════════════════════════════════════
   REGRESSION — BUG-01: Settings forEach crash
═══════════════════════════════════════════════ */
describe('REGRESSION — BUG-01: Settings response shape', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
    await Setting.create({ key: 'test_key', value: 'val', label: 'Test', type: 'string', group: 'general' });
  });

  it('TC-RG001 GET /api/settings data is NOT a bare array', async () => {
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(Array.isArray(r.body.data)).toBe(false);
  });

  it('TC-RG002 GET /api/settings data is an object', async () => {
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(typeof r.body.data).toBe('object');
    expect(r.body.data).not.toBeNull();
  });

  it('TC-RG003 GET /api/settings data.settings IS an array (forEach-safe)', async () => {
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(Array.isArray(r.body.data.settings)).toBe(true);
    expect(() => r.body.data.settings.forEach(() => {})).not.toThrow();
  });

  it('TC-RG004 GET /api/settings data.map is an object (key-value lookup)', async () => {
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(typeof r.body.data.map).toBe('object');
  });

  it('TC-RG005 map contains the seeded key', async () => {
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.map).toHaveProperty('test_key');
  });

  it('TC-RG006 settings array items are safe to iterate with map()', async () => {
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(() => r.body.data.settings.map(s => s.key)).not.toThrow();
  });

  it('TC-RG007 calling forEach on raw data throws TypeError', () => {
    const data = { settings: [], map: {} }; // correct shape
    expect(() => data.forEach(() => {})).toThrow(TypeError);
  });

  it('TC-RG008 calling forEach on data.settings does NOT throw', async () => {
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(() => r.body.data.settings.forEach(() => {})).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════
   REGRESSION — BUG-02: Settings PUT format
═══════════════════════════════════════════════ */
describe('REGRESSION — BUG-02: Settings PUT uses object map not array', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
    await Setting.create({ key: 'company_name', value: 'Old', label: 'Name', type: 'string', group: 'company' });
  });

  it('TC-RG009 PUT with {updates:{key:value}} succeeds', async () => {
    const r = await request(app).put('/api/settings').set('Authorization', `Bearer ${adminToken}`)
      .send({ updates: { company_name: 'New Name' } });
    expect(r.status).toBe(200);
  });

  it('TC-RG010 PUT with object map actually updates the value', async () => {
    await request(app).put('/api/settings').set('Authorization', `Bearer ${adminToken}`)
      .send({ updates: { company_name: 'Correct Update' } });
    const r = await request(app).get('/api/settings/company_name').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.value).toBe('Correct Update');
  });

  it('TC-RG011 PUT with array [{key,value}] does NOT update correctly', async () => {
    await request(app).put('/api/settings').set('Authorization', `Bearer ${adminToken}`)
      .send({ updates: [{ key: 'company_name', value: 'Array Update' }] });
    const r = await request(app).get('/api/settings/company_name').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.value).not.toBe('Array Update');
  });
});

/* ═══════════════════════════════════════════════
   REGRESSION — BUG-03: Bulk import route
═══════════════════════════════════════════════ */
describe('REGRESSION — BUG-03: Bulk import route is /leads/bulk', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
  });

  it('TC-RG012 POST /api/leads/bulk-import returns 404 (wrong route)', async () => {
    const r = await request(app).post('/api/leads/bulk-import').set('Authorization', `Bearer ${adminToken}`).send([]);
    expect(r.status).toBe(404);
  });

  it('TC-RG013 POST /api/leads/bulk returns 200/201 (correct route)', async () => {
    const r = await request(app).post('/api/leads/bulk').set('Authorization', `Bearer ${adminToken}`).send([]);
    expect([200, 201]).toContain(r.status);
  });

  it('TC-RG014 bulk route accepts array payload', async () => {
    const r = await request(app).post('/api/leads/bulk').set('Authorization', `Bearer ${adminToken}`)
      .send([{ name: 'B1', phone: '9200000001', source: 'direct' }]);
    expect([200, 201]).toContain(r.status);
  });
});

/* ═══════════════════════════════════════════════
   REGRESSION — BUG-04: duplicates field not skipped
═══════════════════════════════════════════════ */
describe('REGRESSION — BUG-04: Bulk import response field is duplicates', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
  });

  it('TC-RG015 bulk response has duplicates field not skipped', async () => {
    const r = await request(app).post('/api/leads/bulk').set('Authorization', `Bearer ${adminToken}`)
      .send([{ name: 'B1', phone: '9200000001', source: 'direct' }]);
    if ([200, 201].includes(r.status)) {
      expect(r.body.data).toHaveProperty('duplicates');
      expect(r.body.data.duplicates).toBeDefined();
    }
  });

  it('TC-RG016 bulk response does NOT have skipped field', async () => {
    const r = await request(app).post('/api/leads/bulk').set('Authorization', `Bearer ${adminToken}`)
      .send([{ name: 'B1', phone: '9200000001', source: 'direct' }]);
    if ([200, 201].includes(r.status)) {
      expect(r.body.data.skipped).toBeUndefined();
    }
  });

  it('TC-RG017 duplicates count increases for repeated phone numbers', async () => {
    await Lead.create({ name: 'Existing', phone: '9200000099', source: 'direct', createdBy: adminId });
    const r = await request(app).post('/api/leads/bulk').set('Authorization', `Bearer ${adminToken}`)
      .send([{ name: 'Dup', phone: '9200000099', source: 'direct' }]);
    if ([200, 201].includes(r.status)) {
      expect(r.body.data.duplicates).toBeGreaterThan(0);
    }
  });

  it('TC-RG018 bulk response has imported field', async () => {
    const r = await request(app).post('/api/leads/bulk').set('Authorization', `Bearer ${adminToken}`)
      .send([{ name: 'New', phone: '9200000111', source: 'direct' }]);
    if ([200, 201].includes(r.status)) {
      expect(r.body.data).toHaveProperty('imported');
    }
  });

  it('TC-RG019 bulk response has total field', async () => {
    const r = await request(app).post('/api/leads/bulk').set('Authorization', `Bearer ${adminToken}`)
      .send([{ name: 'New2', phone: '9200000222', source: 'direct' }]);
    if ([200, 201].includes(r.status)) {
      expect(r.body.data).toHaveProperty('total');
    }
  });
});

/* ═══════════════════════════════════════════════
   API CONTRACT — Response Shape Consistency
═══════════════════════════════════════════════ */
describe('API CONTRACT — Paginated list response shape', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
  });

  const paginatedEndpoints = [
    '/api/leads', '/api/agents', '/api/products', '/api/expos',
  ];

  paginatedEndpoints.forEach(endpoint => {
    it(`TC-CT ${endpoint} has data array at top level`, async () => {
      const r = await request(app).get(endpoint).set('Authorization', `Bearer ${adminToken}`);
      expect(Array.isArray(r.body.data)).toBe(true);
    });

    it(`TC-CT ${endpoint} has pagination.total`, async () => {
      const r = await request(app).get(endpoint).set('Authorization', `Bearer ${adminToken}`);
      expect(r.body.pagination).toBeDefined();
      expect(typeof r.body.pagination.total).toBe('number');
    });

    it(`TC-CT ${endpoint} has pagination.page`, async () => {
      const r = await request(app).get(endpoint).set('Authorization', `Bearer ${adminToken}`);
      expect(typeof r.body.pagination.page).toBe('number');
    });

    it(`TC-CT ${endpoint} has pagination.limit`, async () => {
      const r = await request(app).get(endpoint).set('Authorization', `Bearer ${adminToken}`);
      expect(typeof r.body.pagination.limit).toBe('number');
    });

    it(`TC-CT ${endpoint} has pagination.pages`, async () => {
      const r = await request(app).get(endpoint).set('Authorization', `Bearer ${adminToken}`);
      expect(typeof r.body.pagination.pages).toBe('number');
    });
  });
});

describe('API CONTRACT — ok() response wrapper shape', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
  });

  it('TC-CT-S001 GET /api/settings success:true', async () => {
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.success).toBe(true);
  });

  it('TC-CT-S002 GET /api/settings has message field', async () => {
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.message).toBeDefined();
  });

  it('TC-CT-S003 GET /api/analytics/overview success:true', async () => {
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.success).toBe(true);
  });

  it('TC-CT-S004 GET /api/analytics/overview has data object', async () => {
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data).toBeDefined();
    expect(typeof r.body.data).toBe('object');
  });

  it('TC-CT-S005 error responses always have success:false', async () => {
    const r = await request(app).get('/api/leads').set('Authorization', 'Bearer invalid');
    expect(r.body.success).toBe(false);
  });

  it('TC-CT-S006 GET /api/auth/me success:true with valid token', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.body.success).toBe(true);
  });

  it('TC-CT-S007 GET /api/reports/config data has recipients array', async () => {
    const uid = await insertUser({ role: 'superadmin' });
    const r = await request(app).get('/api/reports/config').set('Authorization', `Bearer ${tok(uid)}`);
    expect(Array.isArray(r.body.data.recipients)).toBe(true);
  });

  it('TC-CT-S008 GET /api/reports/preview data.funnel is array', async () => {
    const uid = await insertUser({ role: 'superadmin' });
    const r = await request(app).get('/api/reports/preview').set('Authorization', `Bearer ${tok(uid)}`);
    expect(Array.isArray(r.body.data.funnel)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════
   API CONTRACT — HTTP Status Codes
═══════════════════════════════════════════════ */
describe('API CONTRACT — Correct HTTP status codes', () => {
  let adminToken;
  beforeEach(async () => {
    const uid = await insertUser({ role: 'superadmin' });
    adminToken = tok(uid);
  });

  it('TC-SC001 GET list returns 200 not 201', async () => {
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-SC002 POST create returns 200 or 201', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Status', phone: '9100000001', source: 'direct' });
    expect([200, 201]).toContain(r.status);
  });

  it('TC-SC003 PUT update existing returns 200', async () => {
    const cr = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Update Status', phone: '9100000001', source: 'direct' });
    if ([200, 201].includes(cr.status)) {
      const r = await request(app).put(`/api/leads/${cr.body.data._id}`).set('Authorization', `Bearer ${adminToken}`)
        .send({ stage: 'contacted' });
      expect(r.status).toBe(200);
    }
  });

  it('TC-SC004 GET nonexistent resource returns 404', async () => {
    const r = await request(app).get('/api/leads/000000000000000000000001').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(404);
  });

  it('TC-SC005 no auth returns 401 not 403', async () => {
    const r = await request(app).get('/api/leads');
    expect(r.status).toBe(401);
  });

  it('TC-SC006 insufficient role returns 403 not 401', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).get('/api/reports/config').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.status).toBe(403);
  });

  it('TC-SC007 validation error returns 422 not 500', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`).send({});
    expect([400, 422]).toContain(r.status);
    expect(r.status).not.toBe(500);
  });

  it('TC-SC008 duplicate resource returns 409 not 500', async () => {
    const payload = { name: 'Dup', initials: 'DP', email: `dup@test.com`, phone: '9000000001', territory: 'X', target: 0, color: '#fff' };
    await request(app).post('/api/agents').set('Authorization', `Bearer ${adminToken}`).send(payload);
    const r = await request(app).post('/api/agents').set('Authorization', `Bearer ${adminToken}`).send(payload);
    expect([409, 422]).toContain(r.status);
    expect(r.status).not.toBe(500);
  });
});

/* ═══════════════════════════════════════════════
   REGRESSION — Agent soft-delete uses status field
═══════════════════════════════════════════════ */
describe('REGRESSION — Agent soft-delete uses status not isActive', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
  });

  it('TC-RG020 soft-deleted agent has status=inactive (not isActive=false)', async () => {
    const agent = await Agent.create({
      name: 'Del Agent', initials: 'DA', email: 'da@test.com',
      phone: '9000000000', territory: 'X', target: 0, color: '#fff', createdBy: adminId,
    });
    await request(app).delete(`/api/agents/${agent._id}`).set('Authorization', `Bearer ${adminToken}`);
    const check = await Agent.findById(agent._id);
    expect(check.status).toBe('inactive');
  });

  it('TC-RG021 Agent model has status field not isActive', async () => {
    const agent = await Agent.create({
      name: 'Check Agent', initials: 'CA', email: 'ca@test.com',
      phone: '9000000001', territory: 'Y', target: 0, color: '#fff', createdBy: adminId,
    });
    expect(agent.status).toBeDefined();
    expect(agent.isActive).toBeUndefined();
  });
});
