'use strict';
/**
 * reports.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for GET/PUT /api/reports/config, POST /api/reports/send,
 * and GET /api/reports/preview.
 *
 * nodemailer is mocked so no real SMTP connection is required.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const request     = require('supertest');
const jwt         = require('jsonwebtoken');
const nodemailer  = require('nodemailer');
const app         = require('../src/app');
const db          = require('./helpers/db');
const User        = require('../src/models/User');
const Agent       = require('../src/models/Agent');
const Lead        = require('../src/models/Lead');
const EmailConfig = require('../src/models/EmailConfig');

/* ── Mock nodemailer (SMTP path) ── */
jest.mock('nodemailer');
const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'mock-id' });
const mockVerify   = jest.fn().mockResolvedValue(true);
nodemailer.createTransport.mockReturnValue({
  sendMail: mockSendMail,
  verify:   mockVerify,
});

/* ── Mock resend (HTTP path) ── */
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: { id: 'mock-resend-id' }, error: null }) },
  })),
}), { virtual: true });

/* Force SMTP path in tests — set dummy SMTP vars so assertSmtpConfigured passes */
beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  process.env.SMTP_HOST = 'smtp.test.local';
  process.env.SMTP_USER = 'test@test.local';
  process.env.SMTP_PASS = 'testpass';
});
afterEach(() => {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
});

beforeAll(async () => { await db.connect(); });
afterEach(async () => {
  await db.clearCollections();
  jest.clearAllMocks();
});
afterAll(async () => { await db.disconnect(); });

/* ── helpers ── */
async function insertUser(role) {
  const res = await User.collection.insertOne({
    name: role, email: `${role}_${Date.now()}@test.com`,
    password: '$2b$01$placeholder', role,
    agentId: null, expoId: null, expiresAt: null,
    isTemporary: false, isActive: true,
    lastLogin: null, createdAt: new Date(), updatedAt: new Date(),
  });
  return res.insertedId;
}
function tok(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

/* ─── GET /api/reports/config ─────────────────────────────────── */
describe('GET /api/reports/config', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/reports/config');
    expect(res.status).toBe(401);
  });

  it('returns 403 for agent role', async () => {
    const uid = await insertUser('agent');
    const res = await request(app)
      .get('/api/reports/config')
      .set('Authorization', `Bearer ${tok(uid)}`);
    expect(res.status).toBe(403);
  });

  it('returns 403 for manager role', async () => {
    const uid = await insertUser('manager');
    const res = await request(app)
      .get('/api/reports/config')
      .set('Authorization', `Bearer ${tok(uid)}`);
    expect(res.status).toBe(403);
  });

  it('returns config for superadmin (creates default if none exists)', async () => {
    const uid = await insertUser('superadmin');
    const res = await request(app)
      .get('/api/reports/config')
      .set('Authorization', `Bearer ${tok(uid)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const cfg = res.body.data;
    expect(cfg).toHaveProperty('recipients');
    expect(cfg).toHaveProperty('periodicity');
    expect(cfg).toHaveProperty('sendTime');
    expect(cfg).toHaveProperty('template');
    expect(cfg.template).toHaveProperty('subject');
    expect(cfg.template).toHaveProperty('body');
    expect(cfg).toHaveProperty('lastSentAt');
  });

  it('returns existing config when one already exists', async () => {
    await EmailConfig.create({ recipients: ['a@b.com'], periodicity: 'weekly' });
    const uid = await insertUser('superadmin');
    const res = await request(app)
      .get('/api/reports/config')
      .set('Authorization', `Bearer ${tok(uid)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.recipients).toContain('a@b.com');
    expect(res.body.data.periodicity).toBe('weekly');
  });
});

/* ─── PUT /api/reports/config ─────────────────────────────────── */
describe('PUT /api/reports/config', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).put('/api/reports/config').send({ periodicity: 'daily' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for manager', async () => {
    const uid = await insertUser('manager');
    const res = await request(app)
      .put('/api/reports/config')
      .set('Authorization', `Bearer ${tok(uid)}`)
      .send({ periodicity: 'daily' });
    expect(res.status).toBe(403);
  });

  it('updates recipients', async () => {
    const uid = await insertUser('superadmin');
    const res = await request(app)
      .put('/api/reports/config')
      .set('Authorization', `Bearer ${tok(uid)}`)
      .send({ recipients: ['a@example.com', 'B@Example.COM'] });
    expect(res.status).toBe(200);
    // emails normalised to lowercase
    expect(res.body.data.recipients).toEqual(['a@example.com', 'b@example.com']);
  });

  it('rejects invalid email in recipients', async () => {
    const uid = await insertUser('superadmin');
    const res = await request(app)
      .put('/api/reports/config')
      .set('Authorization', `Bearer ${tok(uid)}`)
      .send({ recipients: ['valid@ok.com', 'not-an-email'] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('updates periodicity', async () => {
    const uid = await insertUser('superadmin');
    const res = await request(app)
      .put('/api/reports/config')
      .set('Authorization', `Bearer ${tok(uid)}`)
      .send({ periodicity: 'monthly' });
    expect(res.status).toBe(200);
    expect(res.body.data.periodicity).toBe('monthly');
  });

  it('rejects invalid periodicity', async () => {
    const uid = await insertUser('superadmin');
    const res = await request(app)
      .put('/api/reports/config')
      .set('Authorization', `Bearer ${tok(uid)}`)
      .send({ periodicity: 'hourly' });
    expect(res.status).toBe(400);
  });

  it('updates sendTime', async () => {
    const uid = await insertUser('superadmin');
    const res = await request(app)
      .put('/api/reports/config')
      .set('Authorization', `Bearer ${tok(uid)}`)
      .send({ sendTime: '14:30' });
    expect(res.status).toBe(200);
    expect(res.body.data.sendTime).toBe('14:30');
  });

  it('rejects invalid sendTime format', async () => {
    const uid = await insertUser('superadmin');
    const res = await request(app)
      .put('/api/reports/config')
      .set('Authorization', `Bearer ${tok(uid)}`)
      .send({ sendTime: '9:5' });
    expect(res.status).toBe(400);
  });

  it('updates template subject and body', async () => {
    const uid = await insertUser('superadmin');
    const res = await request(app)
      .put('/api/reports/config')
      .set('Authorization', `Bearer ${tok(uid)}`)
      .send({ template: { subject: 'My {{date}} report', body: 'Hi, see {{period}}' } });
    expect(res.status).toBe(200);
    expect(res.body.data.template.subject).toBe('My {{date}} report');
    expect(res.body.data.template.body).toBe('Hi, see {{period}}');
  });
});

/* ─── POST /api/reports/send ──────────────────────────────────── */
describe('POST /api/reports/send', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/reports/send');
    expect(res.status).toBe(401);
  });

  it('returns 403 for agent', async () => {
    const uid = await insertUser('agent');
    const res = await request(app)
      .post('/api/reports/send')
      .set('Authorization', `Bearer ${tok(uid)}`);
    expect(res.status).toBe(403);
  });

  it('returns 400 when no recipients configured', async () => {
    const uid = await insertUser('manager');
    // config exists but has no recipients
    await EmailConfig.create({ recipients: [], periodicity: 'daily' });
    const res = await request(app)
      .post('/api/reports/send')
      .set('Authorization', `Bearer ${tok(uid)}`);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('sends report successfully (nodemailer mocked)', async () => {
    await EmailConfig.create({
      recipients: ['test@example.com'],
      periodicity: 'weekly',
      template: { subject: 'Report {{date}}', body: 'See {{period}}' },
    });
    const uid = await insertUser('manager');
    const res = await request(app)
      .post('/api/reports/send')
      .set('Authorization', `Bearer ${tok(uid)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('subject');
    expect(res.body.data).toHaveProperty('recipients', 1);
    expect(res.body.data).toHaveProperty('sentAt');
    expect(res.body.data.filename).toMatch(/\.xlsx$/);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  }, 30000);

  it('superadmin can also send reports', async () => {
    await EmailConfig.create({ recipients: ['admin@x.com'], periodicity: 'daily' });
    const uid = await insertUser('superadmin');
    const res = await request(app)
      .post('/api/reports/send')
      .set('Authorization', `Bearer ${tok(uid)}`);
    expect(res.status).toBe(200);
  }, 30000);

  it('updates lastSentAt after successful send', async () => {
    await EmailConfig.create({ recipients: ['r@r.com'], periodicity: 'daily' });
    const uid = await insertUser('manager');
    await request(app)
      .post('/api/reports/send')
      .set('Authorization', `Bearer ${tok(uid)}`);
    const cfg = await EmailConfig.findOne({});
    expect(cfg.lastSentAt).not.toBeNull();
  }, 30000);
});

/* ─── GET /api/reports/preview ────────────────────────────────── */
describe('GET /api/reports/preview', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/reports/preview');
    expect(res.status).toBe(401);
  });

  it('returns 403 for agent', async () => {
    const uid = await insertUser('agent');
    const res = await request(app)
      .get('/api/reports/preview')
      .set('Authorization', `Bearer ${tok(uid)}`);
    expect(res.status).toBe(403);
  });

  it('returns preview data shape for manager', async () => {
    const uid = await insertUser('manager');
    const res = await request(app)
      .get('/api/reports/preview')
      .set('Authorization', `Bearer ${tok(uid)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d).toHaveProperty('generatedAt');
    expect(d).toHaveProperty('agentStats');
    expect(d).toHaveProperty('funnel');
    expect(d).toHaveProperty('totalLeads');
    expect(d).toHaveProperty('config');
    expect(Array.isArray(d.agentStats)).toBe(true);
    expect(Array.isArray(d.funnel)).toBe(true);
  });

  it('returns correct stage names in funnel', async () => {
    const uid = await insertUser('superadmin');
    const res = await request(app)
      .get('/api/reports/preview')
      .set('Authorization', `Bearer ${tok(uid)}`);
    expect(res.status).toBe(200);
    const stages = res.body.data.funnel.map(f => f.stage);
    expect(stages).toContain('new');
    expect(stages).toContain('won');
    expect(stages).toContain('lost');
    expect(stages).toHaveLength(7);
  });

  it('reflects actual lead data in preview', async () => {
    // Create an agent and two won leads
    const adminId = await insertUser('superadmin');
    const agentRes = await Agent.create({
      name: 'Test Agent', initials: 'TA',
      email: 'ta@test.com', phone: '9000000000',
      territory: 'Delhi', designation: 'Agent',
      target: 100000, color: '#abc', createdBy: adminId,
    });
    await Lead.create([
      { name: 'L1', phone: '9100000001', source: 'direct', stage: 'won',
        value: 50000, assignedAgent: agentRes._id, createdBy: adminId },
      { name: 'L2', phone: '9100000002', source: 'direct', stage: 'new',
        value: 20000, assignedAgent: agentRes._id, createdBy: adminId },
    ]);

    const res = await request(app)
      .get('/api/reports/preview')
      .set('Authorization', `Bearer ${tok(adminId)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.totalLeads).toBe(2);

    const agentStat = res.body.data.agentStats.find(a => a.name === 'Test Agent');
    expect(agentStat).toBeDefined();
    expect(agentStat.totalLeads).toBe(2);
    expect(agentStat.won).toBe(1);
    expect(agentStat.wonValue).toBe(50000);
  });
});
