'use strict';
const request = require('supertest');
const app     = require('../src/app');
const db      = require('./helpers/db');
const User    = require('../src/models/User');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearCollections(); });
afterAll(async () => { await db.disconnect(); });

async function loginAs(role = 'superadmin') {
  const emailMap = { superadmin: 'admin@t.com', manager: 'mgr@t.com', agent: 'agt@t.com', readonly: 'ro@t.com' };
  const email = emailMap[role];
  await User.create({ name: role, email, password: 'Pass@1234', role, isActive: true });
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
  it('readonly can list agents', async () => {
    const token = await loginAs('readonly');
    const res   = await request(app).get('/api/agents').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/agents', () => {
  it('manager can create agent', async () => {
    const token = await loginAs('manager');
    const res   = await request(app).post('/api/agents').set('Authorization', `Bearer ${token}`).send(sampleAgent);
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Test Agent');
  });

  it('readonly cannot create agent', async () => {
    const token = await loginAs('readonly');
    const res   = await request(app).post('/api/agents').set('Authorization', `Bearer ${token}`).send(sampleAgent);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/agents/:id/stats', () => {
  it('returns stats for an agent', async () => {
    const token  = await loginAs('manager');
    const create = await request(app).post('/api/agents').set('Authorization', `Bearer ${token}`).send(sampleAgent);
    const id     = create.body.data._id;

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

    const mgrToken = await loginAs('manager');
    const res = await request(app).delete(`/api/agents/${id}`).set('Authorization', `Bearer ${mgrToken}`);
    expect(res.status).toBe(403);
  });
});
