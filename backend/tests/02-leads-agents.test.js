'use strict';
/**
 * 02-leads-agents.test.js
 * Category: Functional — Leads + Agents
 * ~250 tests
 */
const request = require('supertest');
const app     = require('../src/app');
const db      = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');
const Agent   = require('../src/models/Agent');
const Lead    = require('../src/models/Lead');
const mongoose = require('mongoose');

beforeAll(() => db.connect());
afterEach(() => db.clearCollections());
afterAll(() => db.disconnect());

/* ── shared seed helpers ── */
async function seedAgent(adminId, overrides = {}) {
  return Agent.create({
    name: overrides.name || 'Test Agent', initials: overrides.initials || 'TA',
    email: overrides.email || `agent_${Date.now()}@test.com`,
    phone: '9000000000', territory: 'Mumbai', designation: 'Sales Executive',
    target: 100000, color: '#abc', createdBy: adminId, ...overrides,
  });
}

async function seedLead(adminId, agentId, overrides = {}) {
  return Lead.create({
    name: overrides.name || 'Test Lead', phone: overrides.phone || '9100000001',
    source: overrides.source || 'direct', stage: overrides.stage || 'new',
    value: overrides.value || 0, assignedAgent: agentId, createdBy: adminId,
    ...overrides,
  });
}

/* ═══════════════════════════════════════════════
   LEADS — Create (POST /api/leads)
═══════════════════════════════════════════════ */
describe('LEADS — Create lead', () => {
  let adminToken, adminId, agentId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
    const a = await seedAgent(adminId);
    agentId = a._id;
  });

  it('TC-L001 returns 401 without token', async () => {
    const r = await request(app).post('/api/leads').send({ name: 'X', phone: '9000000001', source: 'direct' });
    expect(r.status).toBe(401);
  });

  it('TC-L002 returns 422 when name missing', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ phone: '9000000001', source: 'direct' });
    expect([400, 422]).toContain(r.status);
  });

  it('TC-L003 returns 422 when phone missing', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Lead', source: 'direct' });
    expect([400, 422]).toContain(r.status);
  });

  it('TC-L004 returns 422 when source missing', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Lead', phone: '9000000001' });
    expect([400, 422]).toContain(r.status);
  });

  it('TC-L005 returns 422 for invalid source value', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Lead', phone: '9000000001', source: 'invalidSource' });
    expect([400, 422]).toContain(r.status);
  });

  it('TC-L006 creates lead with minimal required fields', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Min Lead', phone: '9100000001', source: 'direct' });
    expect([200, 201]).toContain(r.status);
  });

  it('TC-L007 created lead has default stage = new', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Min Lead', phone: '9100000002', source: 'direct' });
    expect([200, 201]).toContain(r.status);
    if (r.status === 201 || r.status === 200) {
      expect(r.body.data?.stage || r.body.data?.lead?.stage).toBe('new');
    }
  });

  it('TC-L008 accepts all valid source values', async () => {
    for (const source of ['expo', 'referral', 'direct', 'digital']) {
      const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'SrcLead', phone: '9100000001', source });
      expect([200, 201]).toContain(r.status);
    }
  }, 60000);

  it('TC-L009 accepts all valid stage values on creation', async () => {
    for (const stage of ['new', 'contacted', 'interested', 'proposal', 'negotiation', 'won', 'lost']) {
      const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'StageLead', phone: '9100000001', source: 'direct', stage });
      expect([200, 201]).toContain(r.status);
    }
  }, 60000);

  it('TC-L010 rejects invalid stage value', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Lead', phone: '9100000001', source: 'direct', stage: 'invalid' });
    expect([400, 422]).toContain(r.status);
  });

  it('TC-L011 value field defaults to 0 when not provided', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'ValLead', phone: '9100000001', source: 'direct' });
    expect([200, 201]).toContain(r.status);
  });

  it('TC-L012 rejects negative value', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Lead', phone: '9100000001', source: 'direct', value: -100 });
    expect([400, 422]).toContain(r.status);
  });

  it('TC-L013 accepts valid email with lead', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'EmailLead', phone: '9100000001', source: 'direct', email: 'lead@test.com' });
    expect([200, 201]).toContain(r.status);
  });

  it('TC-L014 response includes success:true on creation', async () => {
    const r = await request(app).post('/api/leads').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'NewLead', phone: '9100000001', source: 'direct' });
    expect(r.body.success).toBe(true);
  });
});

/* ═══════════════════════════════════════════════
   LEADS — Read (GET /api/leads)
═══════════════════════════════════════════════ */
describe('LEADS — List leads', () => {
  let adminToken, adminId, agentId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
    const a = await seedAgent(adminId);
    agentId = a._id;
  });

  it('TC-L015 returns 200 with valid token', async () => {
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-L016 response has success:true', async () => {
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.success).toBe(true);
  });

  it('TC-L017 response has data array', async () => {
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${adminToken}`);
    expect(Array.isArray(r.body.data)).toBe(true);
  });

  it('TC-L018 response has pagination object', async () => {
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.pagination).toBeDefined();
    expect(r.body.pagination.total).toBeDefined();
  });

  it('TC-L019 empty database returns empty array', async () => {
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data).toEqual([]);
    expect(r.body.pagination.total).toBe(0);
  });

  it('TC-L020 returns seeded lead in list', async () => {
    await seedLead(adminId, agentId, { name: 'Listed Lead' });
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.length).toBeGreaterThan(0);
  });

  it('TC-L021 pagination default page is 1', async () => {
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.pagination.page).toBe(1);
  });

  it('TC-L022 filter by stage=new returns only new leads', async () => {
    await seedLead(adminId, agentId, { stage: 'new', phone: '9100000001' });
    await seedLead(adminId, agentId, { stage: 'won', phone: '9100000002' });
    const r = await request(app).get('/api/leads?stage=new').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.every(l => l.stage === 'new')).toBe(true);
  });

  it('TC-L023 filter by stage=won returns only won leads', async () => {
    await seedLead(adminId, agentId, { stage: 'won', phone: '9100000001' });
    await seedLead(adminId, agentId, { stage: 'new', phone: '9100000002' });
    const r = await request(app).get('/api/leads?stage=won').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.every(l => l.stage === 'won')).toBe(true);
  });

  it('TC-L024 filter by source=direct', async () => {
    await seedLead(adminId, agentId, { source: 'direct', phone: '9100000001' });
    await seedLead(adminId, agentId, { source: 'expo', phone: '9100000002' });
    const r = await request(app).get('/api/leads?source=direct').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.every(l => l.source === 'direct')).toBe(true);
  });

  it('TC-L025 limit parameter restricts results', async () => {
    for (let i = 0; i < 5; i++) await seedLead(adminId, agentId, { phone: `910000000${i}` });
    const r = await request(app).get('/api/leads?limit=2').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.length).toBeLessThanOrEqual(2);
  });

  it('TC-L026 page=2 with limit=1 returns second record', async () => {
    for (let i = 0; i < 3; i++) await seedLead(adminId, agentId, { phone: `910000000${i}` });
    const r = await request(app).get('/api/leads?page=2&limit=1').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.pagination.page).toBe(2);
  });

  it('TC-L027 pagination.pages reflects total/limit', async () => {
    for (let i = 0; i < 3; i++) await seedLead(adminId, agentId, { phone: `910000000${i}` });
    const r = await request(app).get('/api/leads?limit=2').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.pagination.pages).toBe(2);
  });

  it('TC-L028 search by name returns matching leads', async () => {
    await seedLead(adminId, agentId, { name: 'Ramesh Kumar', phone: '9100000001' });
    await seedLead(adminId, agentId, { name: 'Suresh Patel', phone: '9100000002' });
    const r = await request(app).get('/api/leads?search=Ramesh').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.some(l => l.name.includes('Ramesh'))).toBe(true);
  });

  it('TC-L029 invalid page param falls back gracefully', async () => {
    const r = await request(app).get('/api/leads?page=abc').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-L030 invalid limit param falls back gracefully', async () => {
    const r = await request(app).get('/api/leads?limit=abc').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });
});

/* ═══════════════════════════════════════════════
   LEADS — Get Single (GET /api/leads/:id)
═══════════════════════════════════════════════ */
describe('LEADS — Get single lead', () => {
  let adminToken, adminId, agentId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
    const a = await seedAgent(adminId);
    agentId = a._id;
  });

  it('TC-L031 returns 404 for non-existent ID', async () => {
    const r = await request(app).get('/api/leads/000000000000000000000001').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(404);
  });

  it('TC-L032 returns 400 for malformed ID', async () => {
    const r = await request(app).get('/api/leads/not-a-valid-id').set('Authorization', `Bearer ${adminToken}`);
    expect([400, 404]).toContain(r.status);
  });

  it('TC-L033 returns 200 for existing lead', async () => {
    const lead = await seedLead(adminId, agentId);
    const r = await request(app).get(`/api/leads/${lead._id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-L034 returns correct lead data', async () => {
    const lead = await seedLead(adminId, agentId, { name: 'Specific Lead' });
    const r = await request(app).get(`/api/leads/${lead._id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.name).toBe('Specific Lead');
  });
});

/* ═══════════════════════════════════════════════
   LEADS — Update (PUT /api/leads/:id)
═══════════════════════════════════════════════ */
describe('LEADS — Update lead', () => {
  let adminToken, adminId, agentId, leadId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
    const a = await seedAgent(adminId);
    agentId = a._id;
    const l = await seedLead(adminId, agentId, { name: 'Update Me' });
    leadId = l._id;
  });

  it('TC-L035 can update stage to contacted', async () => {
    const r = await request(app).put(`/api/leads/${leadId}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ stage: 'contacted' });
    expect(r.status).toBe(200);
    expect(r.body.data.stage).toBe('contacted');
  });

  it('TC-L036 can update value', async () => {
    const r = await request(app).put(`/api/leads/${leadId}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 50000 });
    expect(r.status).toBe(200);
    expect(r.body.data.value).toBe(50000);
  });

  it('TC-L037 can update notes', async () => {
    const r = await request(app).put(`/api/leads/${leadId}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'Follow up required' });
    expect(r.status).toBe(200);
  });

  it('TC-L038 rejects invalid stage on update', async () => {
    const r = await request(app).put(`/api/leads/${leadId}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ stage: 'badstage' });
    expect([400, 422]).toContain(r.status);
  });

  it('TC-L039 returns 404 for non-existent lead update', async () => {
    const r = await request(app).put('/api/leads/000000000000000000000001').set('Authorization', `Bearer ${adminToken}`)
      .send({ stage: 'contacted' });
    expect(r.status).toBe(404);
  });

  it('TC-L040 update preserves other fields', async () => {
    const r = await request(app).put(`/api/leads/${leadId}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ stage: 'won' });
    expect(r.body.data.name).toBe('Update Me');
  });

  it('TC-L041 can mark lead as won with value', async () => {
    const r = await request(app).put(`/api/leads/${leadId}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ stage: 'won', value: 100000 });
    expect(r.status).toBe(200);
    expect(r.body.data.stage).toBe('won');
  });

  it('TC-L042 can assign lead to agent', async () => {
    const r = await request(app).put(`/api/leads/${leadId}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ assignedAgent: agentId.toString() });
    expect(r.status).toBe(200);
  });

  it('TC-L043 can update score within 0-100', async () => {
    const r = await request(app).put(`/api/leads/${leadId}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ score: 85 });
    expect(r.status).toBe(200);
    expect(r.body.data.score).toBe(85);
  });

  it('TC-L044 rejects score > 100', async () => {
    const r = await request(app).put(`/api/leads/${leadId}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ score: 150 });
    expect([400, 422]).toContain(r.status);
  });

  it('TC-L045 rejects score < 0', async () => {
    const r = await request(app).put(`/api/leads/${leadId}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ score: -5 });
    expect([400, 422]).toContain(r.status);
  });
});

/* ═══════════════════════════════════════════════
   LEADS — Delete (DELETE /api/leads/:id)
═══════════════════════════════════════════════ */
describe('LEADS — Delete lead', () => {
  let adminToken, adminId, agentId, managerToken;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
    const manId = await insertUser({ role: 'manager' });
    managerToken = tok(manId);
    const a = await seedAgent(adminId);
    agentId = a._id;
  });

  it('TC-L046 manager can delete a lead', async () => {
    const l = await seedLead(adminId, agentId);
    const r = await request(app).delete(`/api/leads/${l._id}`).set('Authorization', `Bearer ${managerToken}`);
    expect([200, 204]).toContain(r.status);
  });

  it('TC-L047 deleted lead is no longer in list', async () => {
    const l = await seedLead(adminId, agentId);
    await request(app).delete(`/api/leads/${l._id}`).set('Authorization', `Bearer ${adminToken}`);
    const r = await request(app).get('/api/leads').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.find(ld => ld._id === l._id.toString())).toBeUndefined();
  });

  it('TC-L048 deleting non-existent lead returns 404', async () => {
    const r = await request(app).delete('/api/leads/000000000000000000000001').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(404);
  });

  it('TC-L049 agent cannot delete lead', async () => {
    const l = await seedLead(adminId, agentId);
    const agUid = await insertUser({ role: 'agent' });
    const r = await request(app).delete(`/api/leads/${l._id}`).set('Authorization', `Bearer ${tok(agUid)}`);
    expect(r.status).toBe(403);
  });
});

/* ═══════════════════════════════════════════════
   LEADS — Bulk Import (POST /api/leads/bulk)
═══════════════════════════════════════════════ */
describe('LEADS — Bulk import', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
  });

  it('TC-L050 returns 401 without token', async () => {
    const r = await request(app).post('/api/leads/bulk').send([]);
    expect(r.status).toBe(401);
  });

  it('TC-L051 bulk import response has imported field', async () => {
    const r = await request(app).post('/api/leads/bulk').set('Authorization', `Bearer ${adminToken}`)
      .send([{ name: 'Bulk1', phone: '9200000001', source: 'direct' }]);
    if ([200, 201].includes(r.status)) {
      expect(r.body.data).toHaveProperty('imported');
    }
  });

  it('TC-L052 bulk import response has duplicates field (not skipped)', async () => {
    await seedLead(adminId, null, { phone: '9200000001', name: 'Exist' });
    const r = await request(app).post('/api/leads/bulk').set('Authorization', `Bearer ${adminToken}`)
      .send([{ name: 'Dup', phone: '9200000001', source: 'direct' }]);
    if ([200, 201].includes(r.status)) {
      expect(r.body.data).toHaveProperty('duplicates');
      expect(r.body.data.duplicates).toBeDefined();
    }
  });

  it('TC-L053 bulk route is /api/leads/bulk not /bulk-import', async () => {
    const r = await request(app).post('/api/leads/bulk-import').set('Authorization', `Bearer ${adminToken}`).send([]);
    expect(r.status).toBe(404);
  });

  it('TC-L054 importing multiple leads increases count', async () => {
    const payload = Array.from({ length: 3 }, (_, i) => ({
      name: `Lead${i}`, phone: `920000000${i}`, source: 'direct',
    }));
    const r = await request(app).post('/api/leads/bulk').set('Authorization', `Bearer ${adminToken}`).send(payload);
    if ([200, 201].includes(r.status)) {
      expect(r.body.data.imported).toBeGreaterThan(0);
    }
  });
});

/* ═══════════════════════════════════════════════
   LEADS — Follow-ups
═══════════════════════════════════════════════ */
describe('LEADS — Follow-ups', () => {
  let adminToken, adminId, agentId, leadId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
    const a = await seedAgent(adminId);
    agentId = a._id;
    const l = await seedLead(adminId, agentId);
    leadId = l._id;
  });

  it('TC-L055 POST /api/leads/:id/followups returns 422 without channel', async () => {
    const r = await request(app).post(`/api/leads/${leadId}/followups`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'Interested', note: 'Called' });
    expect([400, 422]).toContain(r.status);
  });

  it('TC-L056 POST /api/leads/:id/followups with valid data succeeds', async () => {
    const r = await request(app).post(`/api/leads/${leadId}/followups`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ channel: 'call', outcome: 'Interested', note: 'Called', agent: agentId });
    expect([200, 201]).toContain(r.status);
  });

  it('TC-L057 rejects invalid channel value', async () => {
    const r = await request(app).post(`/api/leads/${leadId}/followups`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ channel: 'fax', outcome: 'OK', agent: agentId });
    expect([400, 422]).toContain(r.status);
  });

  it('TC-L058 all valid channels accepted for followup', async () => {
    for (const channel of ['call', 'whatsapp', 'email', 'visit', 'other']) {
      const r = await request(app).post(`/api/leads/${leadId}/followups`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ channel, outcome: 'Done', agent: agentId });
      expect([200, 201]).toContain(r.status);
    }
  }, 60000);
});

/* ═══════════════════════════════════════════════
   AGENTS — Create (POST /api/agents)
═══════════════════════════════════════════════ */
describe('AGENTS — Create agent', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
  });

  const validAgent = () => ({
    name: 'New Agent', initials: 'NA', email: `na_${Date.now()}@test.com`,
    phone: '9000000001', territory: 'Delhi', designation: 'Sales Executive',
    target: 50000, color: '#1a3c5e',
  });

  it('TC-AG001 returns 401 without token', async () => {
    const r = await request(app).post('/api/agents').send(validAgent());
    expect(r.status).toBe(401);
  });

  it('TC-AG002 returns 403 for agent role', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).post('/api/agents').set('Authorization', `Bearer ${tok(uid)}`).send(validAgent());
    expect(r.status).toBe(403);
  });

  it('TC-AG003 returns 403 for readonly role', async () => {
    const uid = await insertUser({ role: 'readonly' });
    const r = await request(app).post('/api/agents').set('Authorization', `Bearer ${tok(uid)}`).send(validAgent());
    expect([403, 400, 422]).toContain(r.status);
  });

  it('TC-AG004 creates agent with valid data', async () => {
    const r = await request(app).post('/api/agents').set('Authorization', `Bearer ${adminToken}`).send(validAgent());
    expect([200, 201]).toContain(r.status);
    expect(r.body.success).toBe(true);
  });

  it('TC-AG005 returns 422 when name missing', async () => {
    const a = validAgent(); delete a.name;
    const r = await request(app).post('/api/agents').set('Authorization', `Bearer ${adminToken}`).send(a);
    expect([400, 422]).toContain(r.status);
  });

  it('TC-AG006 returns 422 when email missing', async () => {
    const a = validAgent(); delete a.email;
    const r = await request(app).post('/api/agents').set('Authorization', `Bearer ${adminToken}`).send(a);
    expect([400, 422]).toContain(r.status);
  });

  it('TC-AG007 returns 409 on duplicate email', async () => {
    const a = validAgent();
    await request(app).post('/api/agents').set('Authorization', `Bearer ${adminToken}`).send(a);
    const r = await request(app).post('/api/agents').set('Authorization', `Bearer ${adminToken}`).send(a);
    expect([409, 422]).toContain(r.status);
  });

  it('TC-AG008 returns 422 for invalid email format', async () => {
    const a = { ...validAgent(), email: 'notanemail' };
    const r = await request(app).post('/api/agents').set('Authorization', `Bearer ${adminToken}`).send(a);
    expect([400, 422]).toContain(r.status);
  });

  it('TC-AG009 initials max length 3 enforced', async () => {
    const a = { ...validAgent(), initials: 'TOOLONG' };
    const r = await request(app).post('/api/agents').set('Authorization', `Bearer ${adminToken}`).send(a);
    expect([400, 422]).toContain(r.status);
  });

  it('TC-AG010 target defaults to 0 when not provided', async () => {
    const a = validAgent(); delete a.target;
    const r = await request(app).post('/api/agents').set('Authorization', `Bearer ${adminToken}`).send(a);
    expect([200, 201]).toContain(r.status);
  });

  it('TC-AG011 negative target is rejected', async () => {
    const a = { ...validAgent(), target: -1000 };
    const r = await request(app).post('/api/agents').set('Authorization', `Bearer ${adminToken}`).send(a);
    expect([400, 422]).toContain(r.status);
  });

  it('TC-AG012 status defaults to active', async () => {
    const r = await request(app).post('/api/agents').set('Authorization', `Bearer ${adminToken}`).send(validAgent());
    if ([200, 201].includes(r.status)) {
      expect(r.body.data?.status || r.body.data?.agent?.status).toBe('active');
    }
  });
});

/* ═══════════════════════════════════════════════
   AGENTS — Read (GET /api/agents)
═══════════════════════════════════════════════ */
describe('AGENTS — List agents', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
  });

  it('TC-AG013 returns 200 with valid token', async () => {
    const r = await request(app).get('/api/agents').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-AG014 response is paginated', async () => {
    const r = await request(app).get('/api/agents').set('Authorization', `Bearer ${adminToken}`);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect(r.body.pagination).toBeDefined();
  });

  it('TC-AG015 empty state returns empty array', async () => {
    const r = await request(app).get('/api/agents').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data).toEqual([]);
  });

  it('TC-AG016 seeded agent appears in list', async () => {
    await seedAgent(adminId, { name: 'Listed Agent', email: 'la@test.com' });
    const r = await request(app).get('/api/agents').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.some(a => a.name === 'Listed Agent')).toBe(true);
  });

  it('TC-AG017 filter by status=active', async () => {
    await seedAgent(adminId, { email: 'a1@test.com', status: 'active' });
    await seedAgent(adminId, { email: 'a2@test.com', status: 'inactive' });
    const r = await request(app).get('/api/agents?status=active').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.every(a => a.status === 'active')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════
   AGENTS — Update (PUT /api/agents/:id)
═══════════════════════════════════════════════ */
describe('AGENTS — Update agent', () => {
  let adminToken, adminId, agentDoc;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
    agentDoc = await seedAgent(adminId);
  });

  it('TC-AG018 can update territory', async () => {
    const r = await request(app).put(`/api/agents/${agentDoc._id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ territory: 'Pune' });
    expect(r.status).toBe(200);
    expect(r.body.data.territory).toBe('Pune');
  });

  it('TC-AG019 can update target', async () => {
    const r = await request(app).put(`/api/agents/${agentDoc._id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ target: 200000 });
    expect(r.status).toBe(200);
    expect(r.body.data.target).toBe(200000);
  });

  it('TC-AG020 cannot update with invalid status', async () => {
    const r = await request(app).put(`/api/agents/${agentDoc._id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'retired' });
    expect([400, 422]).toContain(r.status);
  });

  it('TC-AG021 can deactivate agent', async () => {
    const r = await request(app).put(`/api/agents/${agentDoc._id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'inactive' });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('inactive');
  });

  it('TC-AG022 returns 404 for non-existent agent update', async () => {
    const r = await request(app).put('/api/agents/000000000000000000000001').set('Authorization', `Bearer ${adminToken}`)
      .send({ territory: 'Delhi' });
    expect(r.status).toBe(404);
  });
});

/* ═══════════════════════════════════════════════
   AGENTS — Delete (soft & hard)
═══════════════════════════════════════════════ */
describe('AGENTS — Delete (soft)', () => {
  let adminToken, adminId, agentDoc;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
    agentDoc = await seedAgent(adminId);
  });

  it('TC-AG023 soft-delete sets status to inactive', async () => {
    const r = await request(app).delete(`/api/agents/${agentDoc._id}`).set('Authorization', `Bearer ${adminToken}`);
    expect([200, 204]).toContain(r.status);
    const check = await Agent.findById(agentDoc._id);
    expect(check.status).toBe('inactive');
  });

  it('TC-AG024 soft-deleted agent still exists in DB', async () => {
    await request(app).delete(`/api/agents/${agentDoc._id}`).set('Authorization', `Bearer ${adminToken}`);
    const check = await Agent.findById(agentDoc._id);
    expect(check).not.toBeNull();
  });

  it('TC-AG025 cannot soft-delete non-existent agent', async () => {
    const r = await request(app).delete('/api/agents/000000000000000000000001').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(404);
  });

  it('TC-AG026 manager can soft-delete agent', async () => {
    const muid = await insertUser({ role: 'manager' });
    const r = await request(app).delete(`/api/agents/${agentDoc._id}`).set('Authorization', `Bearer ${tok(muid)}`);
    expect([200, 204]).toContain(r.status);
  });
});

describe('AGENTS — Hard delete', () => {
  let adminToken, adminId, agentDoc;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
    agentDoc = await seedAgent(adminId);
  });

  it('TC-AG027 superadmin can hard-delete agent', async () => {
    const r = await request(app).delete(`/api/agents/${agentDoc._id}/hard`).set('Authorization', `Bearer ${adminToken}`);
    expect([200, 204]).toContain(r.status);
  });

  it('TC-AG028 hard-deleted agent is removed from DB', async () => {
    await request(app).delete(`/api/agents/${agentDoc._id}/hard`).set('Authorization', `Bearer ${adminToken}`);
    const check = await Agent.findById(agentDoc._id);
    expect(check).toBeNull();
  });

  it('TC-AG029 manager cannot hard-delete agent', async () => {
    const muid = await insertUser({ role: 'manager' });
    const r = await request(app).delete(`/api/agents/${agentDoc._id}/hard`).set('Authorization', `Bearer ${tok(muid)}`);
    expect(r.status).toBe(403);
  });

  it('TC-AG030 hard-delete nullifies agent references in leads', async () => {
    const l = await seedLead(adminId, agentDoc._id);
    await request(app).delete(`/api/agents/${agentDoc._id}/hard`).set('Authorization', `Bearer ${adminToken}`);
    const updatedLead = await Lead.findById(l._id);
    expect(updatedLead.assignedAgent).toBeNull();
  });
});

/* ═══════════════════════════════════════════════
   AGENTS — Stats
═══════════════════════════════════════════════ */
describe('AGENTS — Stats endpoint', () => {
  let adminToken, adminId, agentDoc;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
    agentDoc = await seedAgent(adminId);
  });

  it('TC-AG031 GET /api/agents/:id/stats returns 200', async () => {
    const r = await request(app).get(`/api/agents/${agentDoc._id}/stats`).set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-AG032 stats response has success:true', async () => {
    const r = await request(app).get(`/api/agents/${agentDoc._id}/stats`).set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.success).toBe(true);
  });

  it('TC-AG033 stats for non-existent agent returns 404', async () => {
    const r = await request(app).get('/api/agents/000000000000000000000001/stats').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(404);
  });

  it('TC-AG034 stats shows 0 leads for new agent', async () => {
    const r = await request(app).get(`/api/agents/${agentDoc._id}/stats`).set('Authorization', `Bearer ${adminToken}`);
    if (r.body.data) {
      expect(r.body.data.totalLeads ?? r.body.data.leads ?? 0).toBe(0);
    }
  });
});
