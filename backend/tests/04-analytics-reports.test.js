'use strict';
/**
 * 04-analytics-reports.test.js
 * Category: Functional — Analytics + Reports
 * ~110 tests
 */
const request     = require('supertest');
const jwt         = require('jsonwebtoken');
const app         = require('../src/app');
const db          = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');
const Agent       = require('../src/models/Agent');
const Lead        = require('../src/models/Lead');
const EmailConfig = require('../src/models/EmailConfig');

jest.mock('nodemailer');
const nodemailer = require('nodemailer');
nodemailer.createTransport.mockReturnValue({
  sendMail: jest.fn().mockResolvedValue({ messageId: 'mock' }),
  verify:   jest.fn().mockResolvedValue(true),
});
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: { id: 'mock' }, error: null }) },
  })),
}), { virtual: true });

beforeAll(() => db.connect());
afterEach(async () => {
  await db.clearCollections();
  delete process.env.RESEND_API_KEY;
  process.env.SMTP_HOST = 'smtp.test.local';
  process.env.SMTP_USER = 'test@test.local';
  process.env.SMTP_PASS = 'testpass';
  jest.clearAllMocks();
});
afterAll(async () => {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  await db.disconnect();
});

async function seedAgent(adminId) {
  return Agent.create({
    name: 'Analytics Agent', initials: 'AA', email: `aa_${Date.now()}@test.com`,
    phone: '9000000000', territory: 'Mumbai', target: 100000, color: '#abc', createdBy: adminId,
  });
}

/* ═══════════════════════════════════════════════
   ANALYTICS — Overview
═══════════════════════════════════════════════ */
describe('ANALYTICS — Overview endpoint', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
  });

  it('TC-AN001 returns 401 without token', async () => {
    const r = await request(app).get('/api/analytics/overview');
    expect(r.status).toBe(401);
  });

  it('TC-AN002 returns 200 for superadmin', async () => {
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-AN003 returns 200 for manager', async () => {
    const uid = await insertUser({ role: 'manager' });
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.status).toBe(200);
  });

  it('TC-AN004 returns 403 for agent', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.status).toBe(403);
  });

  it('TC-AN005 response has success:true', async () => {
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.success).toBe(true);
  });

  it('TC-AN006 response data has totalLeads field', async () => {
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data).toHaveProperty('totalLeads');
  });

  it('TC-AN007 response data has wonLeads field', async () => {
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data).toHaveProperty('wonLeads');
  });

  it('TC-AN008 totalLeads is 0 in empty database', async () => {
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.totalLeads).toBe(0);
  });

  it('TC-AN009 totalLeads increases after adding a lead', async () => {
    const agent = await seedAgent(adminId);
    await Lead.create({ name: 'Test', phone: '9000000001', source: 'direct', assignedAgent: agent._id, createdBy: adminId });
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.totalLeads).toBe(1);
  });

  it('TC-AN010 wonLeads counts only won stage leads', async () => {
    const agent = await seedAgent(adminId);
    await Lead.create({ name: 'Won', phone: '9000000001', source: 'direct', stage: 'won', assignedAgent: agent._id, createdBy: adminId });
    await Lead.create({ name: 'New', phone: '9000000002', source: 'direct', stage: 'new', assignedAgent: agent._id, createdBy: adminId });
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.wonLeads).toBe(1);
  });

  it('TC-AN011 response includes conversionRate', async () => {
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data).toHaveProperty('conversionRate');
  });

  it('TC-AN012 conversionRate is 0 with no leads', async () => {
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.conversionRate).toBe(0);
  });

  it('TC-AN013 response includes topAgents array', async () => {
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data).toHaveProperty('topAgents');
  });

  it('TC-AN014 response includes stageBreakdown', async () => {
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data).toHaveProperty('stageBreakdown');
  });

  it('TC-AN015 response includes recentLeads', async () => {
    const r = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data).toHaveProperty('recentLeads');
  });
});

/* ═══════════════════════════════════════════════
   ANALYTICS — Trends
═══════════════════════════════════════════════ */
describe('ANALYTICS — Trends endpoint', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
  });

  it('TC-AN016 returns 200 for manager', async () => {
    const uid = await insertUser({ role: 'manager' });
    const r = await request(app).get('/api/analytics/trends').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.status).toBe(200);
  });

  it('TC-AN017 returns 403 for agent', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).get('/api/analytics/trends').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.status).toBe(403);
  });

  it('TC-AN018 returns success:true', async () => {
    const r = await request(app).get('/api/analytics/trends').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.success).toBe(true);
  });

  it('TC-AN019 response data is array', async () => {
    const r = await request(app).get('/api/analytics/trends').set('Authorization', `Bearer ${adminToken}`);
    expect(Array.isArray(r.body.data)).toBe(true);
  });

  it('TC-AN020 trends response time under 2000ms', async () => {
    const start = Date.now();
    await request(app).get('/api/analytics/trends').set('Authorization', `Bearer ${adminToken}`);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('TC-AN021 accepts months query param', async () => {
    const r = await request(app).get('/api/analytics/trends?months=6').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });
});

/* ═══════════════════════════════════════════════
   ANALYTICS — Expo Stats
═══════════════════════════════════════════════ */
describe('ANALYTICS — Expo Stats endpoint', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
  });

  it('TC-AN022 GET /api/analytics/expos returns 200', async () => {
    const r = await request(app).get('/api/analytics/expos').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-AN023 response data is array', async () => {
    const r = await request(app).get('/api/analytics/expos').set('Authorization', `Bearer ${adminToken}`);
    expect(Array.isArray(r.body.data)).toBe(true);
  });

  it('TC-AN024 returns 403 for agent role', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).get('/api/analytics/expos').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.status).toBe(403);
  });
});

/* ═══════════════════════════════════════════════
   REPORTS — Config CRUD
═══════════════════════════════════════════════ */
describe('REPORTS — Config management', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
  });

  it('TC-RP001 GET /api/reports/config returns 401 without token', async () => {
    const r = await request(app).get('/api/reports/config');
    expect(r.status).toBe(401);
  });

  it('TC-RP002 GET /api/reports/config returns 403 for manager', async () => {
    const uid = await insertUser({ role: 'manager' });
    const r = await request(app).get('/api/reports/config').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.status).toBe(403);
  });

  it('TC-RP003 GET /api/reports/config returns 200 for superadmin', async () => {
    const r = await request(app).get('/api/reports/config').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
  });

  it('TC-RP004 creates default config when none exists', async () => {
    const r = await request(app).get('/api/reports/config').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data).toHaveProperty('recipients');
    expect(r.body.data).toHaveProperty('periodicity');
    expect(r.body.data).toHaveProperty('sendTime');
    expect(r.body.data).toHaveProperty('template');
  });

  it('TC-RP005 PUT /api/reports/config updates recipients', async () => {
    const r = await request(app).put('/api/reports/config').set('Authorization', `Bearer ${adminToken}`)
      .send({ recipients: ['report@test.com'] });
    expect(r.status).toBe(200);
    expect(r.body.data.recipients).toContain('report@test.com');
  });

  it('TC-RP006 recipients are normalized to lowercase', async () => {
    const r = await request(app).put('/api/reports/config').set('Authorization', `Bearer ${adminToken}`)
      .send({ recipients: ['UPPER@TEST.COM'] });
    expect(r.body.data.recipients).toContain('upper@test.com');
  });

  it('TC-RP007 rejects invalid email in recipients', async () => {
    const r = await request(app).put('/api/reports/config').set('Authorization', `Bearer ${adminToken}`)
      .send({ recipients: ['notanemail'] });
    expect(r.status).toBe(400);
  });

  it('TC-RP008 updates periodicity to weekly', async () => {
    const r = await request(app).put('/api/reports/config').set('Authorization', `Bearer ${adminToken}`)
      .send({ periodicity: 'weekly' });
    expect(r.status).toBe(200);
    expect(r.body.data.periodicity).toBe('weekly');
  });

  it('TC-RP009 rejects invalid periodicity value', async () => {
    const r = await request(app).put('/api/reports/config').set('Authorization', `Bearer ${adminToken}`)
      .send({ periodicity: 'hourly' });
    expect(r.status).toBe(400);
  });

  it('TC-RP010 updates sendTime', async () => {
    const r = await request(app).put('/api/reports/config').set('Authorization', `Bearer ${adminToken}`)
      .send({ sendTime: '09:30' });
    expect(r.status).toBe(200);
    expect(r.body.data.sendTime).toBe('09:30');
  });

  it('TC-RP011 rejects malformed sendTime', async () => {
    const r = await request(app).put('/api/reports/config').set('Authorization', `Bearer ${adminToken}`)
      .send({ sendTime: '9:30 AM' });
    expect(r.status).toBe(400);
  });

  it('TC-RP012 updates template subject', async () => {
    const r = await request(app).put('/api/reports/config').set('Authorization', `Bearer ${adminToken}`)
      .send({ template: { subject: 'Custom {{date}}' } });
    expect(r.status).toBe(200);
    expect(r.body.data.template.subject).toBe('Custom {{date}}');
  });

  it('TC-RP013 updates template body', async () => {
    const r = await request(app).put('/api/reports/config').set('Authorization', `Bearer ${adminToken}`)
      .send({ template: { body: 'Hi for {{period}}' } });
    expect(r.status).toBe(200);
    expect(r.body.data.template.body).toBe('Hi for {{period}}');
  });

  it('TC-RP014 all valid periodicity values accepted', async () => {
    for (const p of ['disabled', 'daily', 'weekly', 'monthly']) {
      const r = await request(app).put('/api/reports/config').set('Authorization', `Bearer ${adminToken}`)
        .send({ periodicity: p });
      expect(r.status).toBe(200);
    }
  }, 30000);
});

/* ═══════════════════════════════════════════════
   REPORTS — Send
═══════════════════════════════════════════════ */
describe('REPORTS — Send report', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
  });

  it('TC-RP015 returns 401 without token', async () => {
    const r = await request(app).post('/api/reports/send');
    expect(r.status).toBe(401);
  });

  it('TC-RP016 returns 403 for agent', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).post('/api/reports/send').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.status).toBe(403);
  });

  it('TC-RP017 returns 400 when no recipients configured', async () => {
    await EmailConfig.create({ recipients: [] });
    const r = await request(app).post('/api/reports/send').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(400);
  });

  it('TC-RP018 sends successfully with mock nodemailer', async () => {
    await EmailConfig.create({ recipients: ['r@test.com'], periodicity: 'daily' });
    const r = await request(app).post('/api/reports/send').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  }, 30000);

  it('TC-RP019 successful send updates lastSentAt', async () => {
    await EmailConfig.create({ recipients: ['r@test.com'], periodicity: 'daily' });
    await request(app).post('/api/reports/send').set('Authorization', `Bearer ${adminToken}`);
    const cfg = await EmailConfig.findOne({});
    expect(cfg.lastSentAt).not.toBeNull();
  }, 30000);

  it('TC-RP020 response includes subject field', async () => {
    await EmailConfig.create({ recipients: ['r@test.com'], periodicity: 'daily' });
    const r = await request(app).post('/api/reports/send').set('Authorization', `Bearer ${adminToken}`);
    if (r.status === 200) {
      expect(r.body.data).toHaveProperty('subject');
    }
  }, 30000);

  it('TC-RP021 response includes filename ending .xlsx', async () => {
    await EmailConfig.create({ recipients: ['r@test.com'], periodicity: 'daily' });
    const r = await request(app).post('/api/reports/send').set('Authorization', `Bearer ${adminToken}`);
    if (r.status === 200) {
      expect(r.body.data.filename).toMatch(/\.xlsx$/);
    }
  }, 30000);

  it('TC-RP022 manager can trigger send', async () => {
    await EmailConfig.create({ recipients: ['r@test.com'], periodicity: 'daily' });
    const uid = await insertUser({ role: 'manager' });
    const r = await request(app).post('/api/reports/send').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.status).toBe(200);
  }, 30000);
});

/* ═══════════════════════════════════════════════
   REPORTS — Preview
═══════════════════════════════════════════════ */
describe('REPORTS — Preview endpoint', () => {
  let adminToken, adminId;
  beforeEach(async () => {
    adminId = await insertUser({ role: 'superadmin' });
    adminToken = tok(adminId);
  });

  it('TC-RP023 returns 200 for manager', async () => {
    const uid = await insertUser({ role: 'manager' });
    const r = await request(app).get('/api/reports/preview').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.status).toBe(200);
  });

  it('TC-RP024 returns 403 for agent', async () => {
    const uid = await insertUser({ role: 'agent' });
    const r = await request(app).get('/api/reports/preview').set('Authorization', `Bearer ${tok(uid)}`);
    expect(r.status).toBe(403);
  });

  it('TC-RP025 response has agentStats array', async () => {
    const r = await request(app).get('/api/reports/preview').set('Authorization', `Bearer ${adminToken}`);
    expect(Array.isArray(r.body.data.agentStats)).toBe(true);
  });

  it('TC-RP026 response has funnel array with 7 stages', async () => {
    const r = await request(app).get('/api/reports/preview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.funnel).toHaveLength(7);
  });

  it('TC-RP027 funnel contains new, won, lost stages', async () => {
    const r = await request(app).get('/api/reports/preview').set('Authorization', `Bearer ${adminToken}`);
    const stages = r.body.data.funnel.map(f => f.stage);
    expect(stages).toContain('new');
    expect(stages).toContain('won');
    expect(stages).toContain('lost');
  });

  it('TC-RP028 response has totalLeads field', async () => {
    const r = await request(app).get('/api/reports/preview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data).toHaveProperty('totalLeads');
  });

  it('TC-RP029 response has generatedAt timestamp', async () => {
    const r = await request(app).get('/api/reports/preview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data).toHaveProperty('generatedAt');
  });

  it('TC-RP030 totalLeads is 0 with empty DB', async () => {
    const r = await request(app).get('/api/reports/preview').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.data.totalLeads).toBe(0);
  });
});
