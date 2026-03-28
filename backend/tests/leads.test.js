'use strict';
const request = require('supertest');
const app     = require('../src/app');
const db      = require('./helpers/db');
const User    = require('../src/models/User');
const Agent   = require('../src/models/Agent');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearCollections(); });
afterAll(async () => { await db.disconnect(); });

/* ─── helpers ────────────────────────────────────────────────────── */

async function setupUsers() {
  /* Manager */
  const mgrUser = await User.create({ name: 'Manager', email: 'mgr@t.com', password: 'Pass@1234', role: 'manager', isActive: true });

  /* Agent with linked Agent profile */
  const agentProfile = await Agent.create({
    name: 'Agt One', initials: 'AO', email: 'agt1@t.com', phone: '9000000001',
    territory: 'Delhi', designation: 'Sales Agent', createdBy: mgrUser._id,
  });
  const agentUser = await User.create({ name: 'Agent One', email: 'agt1@t.com', password: 'Pass@1234', role: 'agent', agentId: agentProfile._id, isActive: true });

  /* Second agent */
  const agentProfile2 = await Agent.create({
    name: 'Agt Two', initials: 'AT', email: 'agt2@t.com', phone: '9000000002',
    territory: 'Mumbai', designation: 'Sales Agent', createdBy: mgrUser._id,
  });
  await User.create({ name: 'Agent Two', email: 'agt2@t.com', password: 'Pass@1234', role: 'agent', agentId: agentProfile2._id, isActive: true });

  return { mgrUser, agentUser, agentProfile, agentProfile2 };
}

async function loginToken(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Pass@1234' });
  return res.body.data.token;
}

/* ─── tests ──────────────────────────────────────────────────────── */

describe('POST /api/leads', () => {
  it('manager can create a lead', async () => {
    const { agentProfile } = await setupUsers();
    const token = await loginToken('mgr@t.com');

    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Lead One', phone: '9111111111', source: 'direct', assignedAgent: agentProfile._id });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Lead One');
  });

  it('agent can create a lead (auto-assigned to self)', async () => {
    await setupUsers();
    const token = await loginToken('agt1@t.com');

    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Lead Two', phone: '9111111112', source: 'direct' });
    expect(res.status).toBe(201);
  });
});

describe('GET /api/leads', () => {
  it('manager sees all leads', async () => {
    const { agentProfile, agentProfile2 } = await setupUsers();
    const mgrToken = await loginToken('mgr@t.com');

    await request(app).post('/api/leads').set('Authorization', `Bearer ${mgrToken}`)
      .send({ name: 'L1', phone: '91001', source: 'direct', assignedAgent: agentProfile._id });
    await request(app).post('/api/leads').set('Authorization', `Bearer ${mgrToken}`)
      .send({ name: 'L2', phone: '91002', source: 'direct', assignedAgent: agentProfile2._id });

    const res = await request(app).get('/api/leads').set('Authorization', `Bearer ${mgrToken}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(2);
  });

  it('agent only sees own leads', async () => {
    const { agentProfile, agentProfile2 } = await setupUsers();
    const mgrToken = await loginToken('mgr@t.com');

    await request(app).post('/api/leads').set('Authorization', `Bearer ${mgrToken}`)
      .send({ name: 'L1', phone: '91001', source: 'direct', assignedAgent: agentProfile._id });
    await request(app).post('/api/leads').set('Authorization', `Bearer ${mgrToken}`)
      .send({ name: 'L2', phone: '91002', source: 'direct', assignedAgent: agentProfile2._id });

    const agtToken = await loginToken('agt1@t.com');
    const res = await request(app).get('/api/leads').set('Authorization', `Bearer ${agtToken}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].name).toBe('L1');
  });
});

describe('PUT /api/leads/:id (agent restrictions)', () => {
  it('agent can only update stage/notes', async () => {
    const { agentProfile } = await setupUsers();
    const mgrToken = await loginToken('mgr@t.com');
    const create = await request(app).post('/api/leads').set('Authorization', `Bearer ${mgrToken}`)
      .send({ name: 'Lead Edit', phone: '91003', source: 'direct', assignedAgent: agentProfile._id });
    const id = create.body.data._id;

    const agtToken = await loginToken('agt1@t.com');
    const res = await request(app).put(`/api/leads/${id}`)
      .set('Authorization', `Bearer ${agtToken}`)
      .send({ stage: 'contacted', name: 'HACKED', phone: '0000' });

    expect(res.status).toBe(200);
    /* Name and phone must remain unchanged */
    expect(res.body.data.name).toBe('Lead Edit');
    expect(res.body.data.phone).toBe('91003');
    expect(res.body.data.stage).toBe('contacted');
  });

  it('agent cannot edit another agent lead', async () => {
    const { agentProfile2 } = await setupUsers();
    const mgrToken = await loginToken('mgr@t.com');
    const create = await request(app).post('/api/leads').set('Authorization', `Bearer ${mgrToken}`)
      .send({ name: 'Other Lead', phone: '91004', source: 'direct', assignedAgent: agentProfile2._id });
    const id = create.body.data._id;

    const agtToken = await loginToken('agt1@t.com');
    const res = await request(app).put(`/api/leads/${id}`).set('Authorization', `Bearer ${agtToken}`).send({ stage: 'won' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/leads/bulk', () => {
  it('manager can bulk import leads', async () => {
    const { agentProfile } = await setupUsers();
    const token = await loginToken('mgr@t.com');

    const leads = [
      { name: 'Bulk 1', phone: '92001', source: 'direct', assignedAgent: agentProfile._id },
      { name: 'Bulk 2', phone: '92002', source: 'referral', assignedAgent: agentProfile._id },
    ];
    const res = await request(app).post('/api/leads/bulk').set('Authorization', `Bearer ${token}`).send({ leads });
    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(2);
  });

  it('detects and skips duplicate phones', async () => {
    const { agentProfile } = await setupUsers();
    const token = await loginToken('mgr@t.com');

    await request(app).post('/api/leads').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Existing', phone: '92001', source: 'direct', assignedAgent: agentProfile._id });

    const leads = [
      { name: 'Dup',   phone: '92001', source: 'direct',   assignedAgent: agentProfile._id },
      { name: 'New1',  phone: '92003', source: 'referral', assignedAgent: agentProfile._id },
    ];
    const res = await request(app).post('/api/leads/bulk').set('Authorization', `Bearer ${token}`).send({ leads });
    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(1);
    expect(res.body.data.duplicates).toBe(1);
  });
});

describe('POST /api/leads/:id/followups', () => {
  it('agent can log a follow-up on their own lead', async () => {
    const { agentProfile } = await setupUsers();
    const mgrToken = await loginToken('mgr@t.com');
    const create = await request(app).post('/api/leads').set('Authorization', `Bearer ${mgrToken}`)
      .send({ name: 'FU Lead', phone: '93001', source: 'direct', assignedAgent: agentProfile._id });
    const id = create.body.data._id;

    const agtToken = await loginToken('agt1@t.com');
    const res = await request(app).post(`/api/leads/${id}/followups`)
      .set('Authorization', `Bearer ${agtToken}`)
      .send({ channel: 'call', note: 'Called, interested', outcome: 'Callback scheduled' });
    expect(res.status).toBe(201);
  });
});
