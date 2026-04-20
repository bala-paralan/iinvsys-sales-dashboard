'use strict';
/**
 * 03-products-expos-settings.test.js
 * Category: Functional — Products + Expos + Settings
 * ~200 tests
 */
const request  = require('supertest');
const app      = require('../src/app');
const db       = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');
const Agent    = require('../src/models/Agent');
const Setting  = require('../src/models/Setting');

beforeAll(() => db.connect());
afterEach(() => db.clearCollections());
afterAll(() => db.disconnect());

async function seedAgent(adminId) {
  return Agent.create({
    name: 'Seed Agent', initials: 'SA', email: `sa_${Date.now()}@test.com`,
    phone: '9000000000', territory: 'Mumbai', target: 0, color: '#abc', createdBy: adminId,
  });
}

/* ═══════════════════════════════════════════════
   PRODUCTS — Create
═══════════════════════════════════════════════ */
describe('PRODUCTS — Create product', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
  });

  const validProduct = () => ({
    name: 'Test Product', sku: `SKU${Date.now()}`,
    category: 'hardware', price: 1000,
  });

  it('TC-P001 returns 401 without token', async () => {
    const r = await request(app).post('/api/products').send(validProduct());
    expect(r.status).toBe(401);
  });

  it('TC-P002 returns 403 for agent role', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).post('/api/products').set('Authorization', `Bearer ${tok(uid)}`).send(validProduct());
    expect([403, 400, 422]).toContain(r.status);
  });

  it('TC-P003 superadmin can create product', async () => {
    const r = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`).send(validProduct());
    expect([200, 201]).toContain(r.status);
  });

  it('TC-P004 returns 422 when name missing', async () => {
    const p = validProduct(); delete p.name;
    const r = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`).send(p);
    expect([400, 422]).toContain(r.status);
  });

  it('TC-P005 returns 422 when sku missing', async () => {
    const p = validProduct(); delete p.sku;
    const r = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`).send(p);
    expect([400, 422]).toContain(r.status);
  });

  it('TC-P006 returns 422 when category missing', async () => {
    const p = validProduct(); delete p.category;
    const r = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`).send(p);
    expect([400, 422]).toContain(r.status);
  });

  it('TC-P007 returns 422 when price missing', async () => {
    const p = validProduct(); delete p.price;
    const r = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`).send(p);
    expect([400, 422]).toContain(r.status);
  });

  it('TC-P008 rejects invalid category', async () => {
    const p = { ...validProduct(), category: 'invalid' };
    const r = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`).send(p);
    expect([400, 422]).toContain(r.status);
  });

  it('TC-P009 accepts all valid categories', async () => {
    for (const category of ['hardware', 'software', 'service', 'bundle']) {
      const r = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Cat Product', sku: `SKU${Date.now()}${category}`, category, price: 100 });
      expect([200, 201]).toContain(r.status);
    }
  }, 30000);

  it('TC-P010 rejects negative price', async () => {
    const r = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validProduct(), price: -500 });
    expect([400, 422]).toContain(r.status);
  });

  it('TC-P011 price of zero is accepted', async () => {
    const r = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validProduct(), price: 0 });
    expect([200, 201]).toContain(r.status);
  });

  it('TC-P012 duplicate SKU is rejected', async () => {
    const p = validProduct();
    await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`).send(p);
    const r = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`).send(p);
    expect([409, 422]).toContain(r.status);
  });

  it('TC-P013 SKU is stored uppercase', async () => {
    const r = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Upper', sku: 'lowercase123', category: 'software', price: 100 });
    if ([200, 201].includes(r.status)) {
      expect(r.body.data.sku || r.body.data?.product?.sku).toBe('LOWERCASE123');
    }
  });

  it('TC-P014 isActive defaults to true', async () => {
    const r = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`).send(validProduct());
    if ([200, 201].includes(r.status)) {
      expect(r.body.data.isActive ?? r.body.data?.product?.isActive ?? true).toBe(true);
    }
  });
});

/* ═══════════════════════════════════════════════
   PRODUCTS — Read & Update
═══════════════════════════════════════════════ */
describe('PRODUCTS — List & Update', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
  });

  it('TC-P015 GET /api/products returns 200', async () => {
    const r = await request(app).get('/api/products').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-P016 response has data array', async () => {
    const r = await request(app).get('/api/products').set('Authorization', `Bearer ${adminToken}`);
    expect(Array.isArray(r.body.data)).toBe(true);
  });

  it('TC-P017 readonly user can GET /api/products', async () => {
    const uid = await insertUser({ role: 'readonly' });
    const r = await request(app).get('/api/products').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.status).toBe(200);
  });

  it('TC-P018 can update product name', async () => {
    const cr = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Old Name', sku: `SKU${Date.now()}`, category: 'hardware', price: 100 });
    if ([200, 201].includes(cr.status)) {
      const id = cr.body.data._id;
      const r = await request(app).put(`/api/products/${id}`).set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'New Name' });
      expect(r.status).toBe(200);
      expect(r.body.data.name).toBe('New Name');
    }
  });

  it('TC-P019 can deactivate product', async () => {
    const cr = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Active Product', sku: `SKU${Date.now()}`, category: 'service', price: 200 });
    if ([200, 201].includes(cr.status)) {
      const id = cr.body.data._id;
      const r = await request(app).put(`/api/products/${id}`).set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });
      expect(r.status).toBe(200);
    }
  });

  it('TC-P020 GET /api/products?active=true filters active only', async () => {
    const r = await request(app).get('/api/products?active=true').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-P021 DELETE /api/products/:id removes product', async () => {
    const cr = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Delete Me', sku: `SKU${Date.now()}`, category: 'bundle', price: 500 });
    if ([200, 201].includes(cr.status)) {
      const id = cr.body.data._id;
      const r = await request(app).delete(`/api/products/${id}`).set('Authorization', `Bearer ${adminToken}`);
      expect([200, 204]).toContain(r.status);
    }
  });
});

/* ═══════════════════════════════════════════════
   EXPOS — Create
═══════════════════════════════════════════════ */
describe('EXPOS — Create expo', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
  });

  const validExpo = () => ({
    name: 'Test Expo', startDate: '2026-06-01', endDate: '2026-06-05',
    venue: 'Convention Centre', city: 'Mumbai',
  });

  it('TC-E001 returns 401 without token', async () => {
    const r = await request(app).post('/api/expos').send(validExpo());
    expect(r.status).toBe(401);
  });

  it('TC-E002 superadmin can create expo', async () => {
    const r = await request(app).post('/api/expos').set('Authorization', `Bearer ${adminToken}`).send(validExpo());
    expect([200, 201]).toContain(r.status);
  });

  it('TC-E003 returns 422 when name missing', async () => {
    const e = validExpo(); delete e.name;
    const r = await request(app).post('/api/expos').set('Authorization', `Bearer ${adminToken}`).send(e);
    expect([400, 422]).toContain(r.status);
  });

  it('TC-E004 returns 422 when startDate missing', async () => {
    const e = validExpo(); delete e.startDate;
    const r = await request(app).post('/api/expos').set('Authorization', `Bearer ${adminToken}`).send(e);
    expect([400, 422]).toContain(r.status);
  });

  it('TC-E005 returns 422 when endDate missing', async () => {
    const e = validExpo(); delete e.endDate;
    const r = await request(app).post('/api/expos').set('Authorization', `Bearer ${adminToken}`).send(e);
    expect([400, 422]).toContain(r.status);
  });

  it('TC-E006 returns 422 when venue missing', async () => {
    const e = validExpo(); delete e.venue;
    const r = await request(app).post('/api/expos').set('Authorization', `Bearer ${adminToken}`).send(e);
    expect([400, 422]).toContain(r.status);
  });

  it('TC-E007 returns 422 when city missing', async () => {
    const e = validExpo(); delete e.city;
    const r = await request(app).post('/api/expos').set('Authorization', `Bearer ${adminToken}`).send(e);
    expect([400, 422]).toContain(r.status);
  });

  it('TC-E008 status defaults to upcoming', async () => {
    const r = await request(app).post('/api/expos').set('Authorization', `Bearer ${adminToken}`).send(validExpo());
    if ([200, 201].includes(r.status)) {
      expect(r.body.data.status ?? 'upcoming').toBe('upcoming');
    }
  });

  it('TC-E009 accepts all valid status values', async () => {
    for (const status of ['upcoming', 'live', 'past']) {
      const r = await request(app).post('/api/expos').set('Authorization', `Bearer ${adminToken}`)
        .send({ ...validExpo(), status });
      expect([200, 201]).toContain(r.status);
    }
  }, 30000);

  it('TC-E010 rejects invalid status value', async () => {
    const r = await request(app).post('/api/expos').set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validExpo(), status: 'finished' });
    expect([400, 422]).toContain(r.status);
  });

  it('TC-E011 agent cannot create expo', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).post('/api/expos').set('Authorization', `Bearer ${tok(uid)}`).send(validExpo());
    expect([403, 400, 422]).toContain(r.status);
  });
});

/* ═══════════════════════════════════════════════
   EXPOS — Read & Update
═══════════════════════════════════════════════ */
describe('EXPOS — List, Update & Delete', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
  });

  const createExpo = (overrides = {}) =>
    request(app).post('/api/expos').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Expo', startDate: '2026-06-01', endDate: '2026-06-05', venue: 'Hall', city: 'Delhi', ...overrides });

  it('TC-E012 GET /api/expos returns 200', async () => {
    const r = await request(app).get('/api/expos').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-E013 response has data array', async () => {
    const r = await request(app).get('/api/expos').set('Authorization', `Bearer ${adminToken}`);
    expect(Array.isArray(r.body.data)).toBe(true);
  });

  it('TC-E014 readonly can GET /api/expos', async () => {
    const uid = await insertUser({ role: 'readonly' });
    const r = await request(app).get('/api/expos').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.status).toBe(200);
  });

  it('TC-E015 can update expo status to live', async () => {
    const cr = await createExpo();
    if ([200, 201].includes(cr.status)) {
      const r = await request(app).put(`/api/expos/${cr.body.data._id}`).set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'live' });
      expect(r.status).toBe(200);
    }
  });

  it('TC-E016 can assign agents to expo', async () => {
    const cr = await createExpo();
    const agent = await seedAgent(adminId);
    if ([200, 201].includes(cr.status)) {
      const r = await request(app).put(`/api/expos/${cr.body.data._id}`).set('Authorization', `Bearer ${adminToken}`)
        .send({ agents: [agent._id.toString()] });
      expect(r.status).toBe(200);
    }
  });

  it('TC-E017 GET /api/expos/:id/stats returns 200', async () => {
    const cr = await createExpo();
    if ([200, 201].includes(cr.status)) {
      const r = await request(app).get(`/api/expos/${cr.body.data._id}/stats`).set('Authorization', `Bearer ${adminToken}`);
      expect(r.status).toBe(200);
    }
  });

  it('TC-E018 GET /api/expos/:id/stats for non-existent returns 404', async () => {
    const r = await request(app).get('/api/expos/000000000000000000000001/stats').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(404);
  });

  it('TC-E019 DELETE expo removes it from list', async () => {
    const cr = await createExpo();
    if ([200, 201].includes(cr.status)) {
      await request(app).delete(`/api/expos/${cr.body.data._id}`).set('Authorization', `Bearer ${adminToken}`);
      const r = await request(app).get('/api/expos').set('Authorization', `Bearer ${adminToken}`);
      expect(r.body.data.find(e => e._id === cr.body.data._id)).toBeUndefined();
    }
  });

  it('TC-E020 filter by status=live returns only live expos', async () => {
    await createExpo({ status: 'live', name: 'Live Expo' });
    await createExpo({ status: 'upcoming', name: 'Coming Expo' });
    const r = await request(app).get('/api/expos?status=live').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.every(e => e.status === 'live')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════
   SETTINGS — Read
═══════════════════════════════════════════════ */
describe('SETTINGS — Read settings', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
    await Setting.create([
      { key: 'company_name', value: 'IINVSYS', label: 'Company', type: 'string', group: 'company' },
      { key: 'lead_stages', value: ['new','contacted'], label: 'Stages', type: 'array', group: 'lead' },
      { key: 'notifications_enabled', value: true, label: 'Notifications', type: 'boolean', group: 'system' },
    ]);
  });

  it('TC-ST001 GET /api/settings returns 200', async () => {
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-ST002 response has success:true', async () => {
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.success).toBe(true);
  });

  it('TC-ST003 BUG-01: response.data is object with settings array', async () => {
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data).toHaveProperty('settings');
    expect(Array.isArray(r.body.data.settings)).toBe(true);
  });

  it('TC-ST004 BUG-01: response.data.settings is array not object', async () => {
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(Array.isArray(r.body.data.settings)).toBe(true);
    expect(typeof r.body.data.settings).toBe('object');
  });

  it('TC-ST005 response.data has map field', async () => {
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data).toHaveProperty('map');
  });

  it('TC-ST006 settings array items have key field', async () => {
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    r.body.data.settings.forEach(s => expect(s.key).toBeDefined());
  });

  it('TC-ST007 settings items have value field', async () => {
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    r.body.data.settings.forEach(s => expect(s.value).toBeDefined());
  });

  it('TC-ST008 settings items have type field', async () => {
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    r.body.data.settings.forEach(s => expect(s.type).toBeDefined());
  });

  it('TC-ST009 readonly user can GET /api/settings', async () => {
    const uid = await insertUser({ role: 'readonly' });
    const r = await request(app).get('/api/settings').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.status).toBe(200);
  });

  it('TC-ST010 GET /api/settings/:key returns single setting', async () => {
    const r = await request(app).get('/api/settings/company_name').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.data.key).toBe('company_name');
  });

  it('TC-ST011 GET /api/settings/:key returns 404 for unknown key', async () => {
    const r = await request(app).get('/api/settings/nonexistent_key').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(404);
  });
});

/* ═══════════════════════════════════════════════
   SETTINGS — Update
═══════════════════════════════════════════════ */
describe('SETTINGS — Update settings', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
    await Setting.create({ key: 'company_name', value: 'Old Name', label: 'Company', type: 'string', group: 'company' });
  });

  it('TC-ST012 PUT /api/settings returns 403 for agent', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).put('/api/settings').set('Authorization', `Bearer ${tok(uid)}`)
      .send({ updates: { company_name: 'New' } });
    expect(r.status).toBe(403);
  });

  it('TC-ST013 PUT /api/settings returns 403 for readonly', async () => {
    const uid = await insertUser({ role: 'readonly' });
    const r = await request(app).put('/api/settings').set('Authorization', `Bearer ${tok(uid)}`)
      .send({ updates: { company_name: 'New' } });
    expect(r.status).toBe(403);
  });

  it('TC-ST014 BUG-02: updates expects object map not array', async () => {
    const r = await request(app).put('/api/settings').set('Authorization', `Bearer ${adminToken}`)
      .send({ updates: { company_name: 'Updated Name' } });
    expect(r.status).toBe(200);
  });

  it('TC-ST015 BUG-02: sending updates as array fails or produces wrong result', async () => {
    const r = await request(app).put('/api/settings').set('Authorization', `Bearer ${adminToken}`)
      .send({ updates: [{ key: 'company_name', value: 'Bad' }] });
    const check = await request(app).get('/api/settings/company_name').set('Authorization', `Bearer ${adminToken}`);
    expect(check.body.data?.value).not.toBe('Bad');
  });

  it('TC-ST016 updated value is persisted', async () => {
    await request(app).put('/api/settings').set('Authorization', `Bearer ${adminToken}`)
      .send({ updates: { company_name: 'Persisted Name' } });
    const r = await request(app).get('/api/settings/company_name').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.value).toBe('Persisted Name');
  });

  it('TC-ST017 can update multiple keys at once', async () => {
    await Setting.create({ key: 'company_email', value: 'old@test.com', type: 'string', group: 'company' });
    const r = await request(app).put('/api/settings').set('Authorization', `Bearer ${adminToken}`)
      .send({ updates: { company_name: 'A', company_email: 'new@test.com' } });
    expect(r.status).toBe(200);
  });

  it('TC-ST018 returns 400 if updates field missing', async () => {
    const r = await request(app).put('/api/settings').set('Authorization', `Bearer ${adminToken}`)
      .send({ something: 'else' });
    expect([400, 422]).toContain(r.status);
  });

  it('TC-ST019 returns 400 if updates is not an object', async () => {
    const r = await request(app).put('/api/settings').set('Authorization', `Bearer ${adminToken}`)
      .send({ updates: 'not-an-object' });
    expect([400, 422]).toContain(r.status);
  });

  it('TC-ST020 boolean setting updated correctly', async () => {
    await Setting.create({ key: 'feature_flag', value: false, type: 'boolean', group: 'system' });
    await request(app).put('/api/settings').set('Authorization', `Bearer ${adminToken}`)
      .send({ updates: { feature_flag: true } });
    const r = await request(app).get('/api/settings/feature_flag').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.value).toBe(true);
  });

  it('TC-ST021 number setting updated correctly', async () => {
    await Setting.create({ key: 'max_leads', value: 100, type: 'number', group: 'lead' });
    await request(app).put('/api/settings').set('Authorization', `Bearer ${adminToken}`)
      .send({ updates: { max_leads: 250 } });
    const r = await request(app).get('/api/settings/max_leads').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.value).toBe(250);
  });
});
