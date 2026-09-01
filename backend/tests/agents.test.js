'use strict';
const request = require('supertest');
const app     = require('../src/app');
const db      = require('./helpers/db');
const User    = require('../src/models/User');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearCollections(); });
afterAll(async () => { await db.disconnect(); });

async function loginAs(role = 'superadmin') {
  /* Derived from the role: the lookup table this replaced was keyed by the v2 role names,
     so every V3 role mapped to `undefined` and failed validation. */
  const email = `${role}@t.com`;
  if (!await User.findOne({ email })) {
    await User.create({ name: role, email, password: 'Pass@1234', role, isActive: true });
  }
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Pass@1234' });
  return res.body.data.token;
}

const sampleAgent = {
  name: 'Test Agent',
  initials: 'TA',
  email: 'tagent@test.com',
  phone: '9000000001',
  territory: 'Delhi',
  designation: 'Sales Agent',
  target: 1000000,
  color: '#e74c3c',
};

describe('GET /api/agents', () => {
  it('a manager can list the directory', async () => {
    const token = await loginAs('sales_director');
    const res   = await request(app).get('/api/agents').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  /* The retired `readonly` floor admitted every internal viewer to the directory —
     names, emails, phones, territories and targets. `directory.read` is now an explicit
     grant, held by heads and above. Regression for tests/10-role-matrix. */
  it('refuses an executive the staff directory', async () => {
    const token = await loginAs('sales_executive');
    const res   = await request(app).get('/api/agents').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/agents', () => {
  /* `POST /api/users` creates an ACCOUNT now, not a directory row — v2's `Agent` had no
     login. Granting access is superadmin's, per `user.write` in doc 04. */
  it('superadmin can create a user', async () => {
    const token = await loginAs('superadmin');
    const res   = await request(app).post('/api/agents').set('Authorization', `Bearer ${token}`).send(sampleAgent);
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Test Agent');
  });

  it('an executive cannot create a user', async () => {
    const token = await loginAs('sales_executive');
    const res   = await request(app).post('/api/agents').set('Authorization', `Bearer ${token}`).send(sampleAgent);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/agents/:id/stats', () => {
  it('returns stats for an agent', async () => {
    /* Creating the account is superadmin's; reading someone's numbers is the Director's,
       and `attachScope` decides whether that person is within their reach. */
    const adminToken = await loginAs('superadmin');
    const create = await request(app).post('/api/agents').set('Authorization', `Bearer ${adminToken}`).send(sampleAgent);
    const id     = create.body.data._id;

    const token = await loginAs('sales_director');
    const res = await request(app).get(`/api/agents/${id}/stats`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('summary');
    expect(res.body.data.summary).toHaveProperty('totalLeads');
  });
});

describe('DELETE /api/agents/:id', () => {
  it('superadmin can deactivate agent', async () => {
    const token  = await loginAs('superadmin');
    const create = await request(app).post('/api/agents').set('Authorization', `Bearer ${token}`).send(sampleAgent);
    const id     = create.body.data._id;

    const res = await request(app).delete(`/api/agents/${id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('manager cannot hard-delete agents', async () => {
    const adminToken = await loginAs('superadmin');
    const create = await request(app).post('/api/agents').set('Authorization', `Bearer ${adminToken}`).send(sampleAgent);
    const id = create.body.data._id;

    const mgrToken = await loginAs('sales_director');
    const res = await request(app).delete(`/api/agents/${id}`).set('Authorization', `Bearer ${mgrToken}`);
    expect(res.status).toBe(403);
  });
});
