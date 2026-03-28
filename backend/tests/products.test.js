'use strict';
const request = require('supertest');
const app     = require('../src/app');
const db      = require('./helpers/db');
const User    = require('../src/models/User');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearCollections(); });
afterAll(async () => { await db.disconnect(); });

/* ─── helpers ────────────────────────────────────────────────────── */

async function loginAs(role = 'superadmin') {
  const emailMap = { superadmin: 'admin@test.com', manager: 'manager@test.com', agent: 'agent@test.com', readonly: 'ro@test.com' };
  const email = emailMap[role];
  await User.create({ name: role, email, password: 'Pass@1234', role, isActive: true });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Pass@1234' });
  return res.body.data.token;
}

const sampleProduct = {
  name: 'Test Product',
  sku: 'TST-001',
  category: 'software',
  price: 9999,
};

/* ─── tests ──────────────────────────────────────────────────────── */

describe('GET /api/products', () => {
  it('returns empty list initially', async () => {
    const token = await loginAs('readonly');
    const res   = await request(app).get('/api/products').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/products', () => {
  it('superadmin can create a product', async () => {
    const token = await loginAs('superadmin');
    const res   = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send(sampleProduct);
    expect(res.status).toBe(201);
    expect(res.body.data.sku).toBe('TST-001');
  });

  it('manager cannot create a product', async () => {
    const token = await loginAs('manager');
    const res   = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send(sampleProduct);
    expect(res.status).toBe(403);
  });

  it('rejects missing required fields', async () => {
    const token = await loginAs('superadmin');
    const res   = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Incomplete' });
    expect(res.status).toBe(422);
  });

  it('rejects duplicate SKU', async () => {
    const token = await loginAs('superadmin');
    await request(app).post('/api/products').set('Authorization', `Bearer ${token}`).send(sampleProduct);
    const res = await request(app).post('/api/products').set('Authorization', `Bearer ${token}`).send(sampleProduct);
    expect(res.status).toBe(409);
  });
});

describe('PUT /api/products/:id', () => {
  it('superadmin can update a product', async () => {
    const token = await loginAs('superadmin');
    const create = await request(app).post('/api/products').set('Authorization', `Bearer ${token}`).send(sampleProduct);
    const id = create.body.data._id;

    const res = await request(app)
      .put(`/api/products/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ...sampleProduct, price: 14999 });
    expect(res.status).toBe(200);
    expect(res.body.data.price).toBe(14999);
  });
});

describe('DELETE /api/products/:id', () => {
  it('superadmin can soft-delete a product', async () => {
    const token = await loginAs('superadmin');
    const create = await request(app).post('/api/products').set('Authorization', `Bearer ${token}`).send(sampleProduct);
    const id = create.body.data._id;

    const res = await request(app).delete(`/api/products/${id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    /* Should be marked inactive */
    const get = await request(app).get(`/api/products/${id}`).set('Authorization', `Bearer ${token}`);
    expect(get.body.data.isActive).toBe(false);
  });

  it('agent cannot delete a product', async () => {
    const adminToken = await loginAs('superadmin');
    const create = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`).send(sampleProduct);
    const id = create.body.data._id;

    const agentToken = await loginAs('agent');
    const res = await request(app).delete(`/api/products/${id}`).set('Authorization', `Bearer ${agentToken}`);
    expect(res.status).toBe(403);
  });
});
