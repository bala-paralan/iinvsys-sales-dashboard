'use strict';
/**
 * Audit trail through the real HTTP paths — R-7.
 *
 * 14-audit-log.test.js proves the model and service behave. This proves the
 * destructive operations that were previously "irrecoverable AND unlogged"
 * now leave a trail: DELETE /api/leads/:id, mergeLead's hard delete of the
 * source, hardDeleteAgent, deleteExpo, deleteReferrer — plus sign-ins.
 */
const request  = require('supertest');
const app      = require('../src/app');
const AuditLog = require('../src/models/AuditLog');
const Lead     = require('../src/models/Lead');
const Agent    = require('../src/models/Agent');
const Expo     = require('../src/models/Expo');
const User     = require('../src/models/User');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');

let adminToken;

const mkLead = (over = {}) => Lead.create({
  name: 'Rajesh Kumar', phone: '9876543210', source: 'inbound_enquiry', ...over,
});

beforeAll(connect);
afterAll(disconnect);
beforeEach(async () => {
  await clearCollections();
  adminToken = tok(await insertUser({ role: 'superadmin', name: 'Root' }));
});

const auth = (r) => r.set('Authorization', `Bearer ${adminToken}`);

describe('sign-in is recorded', () => {
  it('a successful sign-in is attributed to the account', async () => {
    await User.create({
      name: 'Priya', email: 'priya@iinvsys.test', password: 'TestPass@123', role: 'manager',
    });

    const res = await request(app).post('/api/auth/login')
      .send({ email: 'priya@iinvsys.test', password: 'TestPass@123' });
    expect(res.status).toBe(200);

    const e = await AuditLog.findOne({ action: 'auth.login' }).lean();
    expect(e).not.toBeNull();
    expect(e.actor.role).toBe('manager');
  });

  it('a failed sign-in is recorded WITHOUT attributing the claimed identity', async () => {
    await User.create({
      name: 'Priya', email: 'priya@iinvsys.test', password: 'TestPass@123', role: 'manager',
    });

    await request(app).post('/api/auth/login')
      .send({ email: 'priya@iinvsys.test', password: 'WrongPass@123' });

    const e = await AuditLog.findOne({ action: 'auth.login_failed' }).lean();
    expect(e).not.toBeNull();
    expect(e.actor.user).toBeNull();
    expect(e.meta.reason).toBe('invalid_credentials');
    expect(e.summary).toContain('priya@iinvsys.test');
  });

  it('an unknown email is still recorded — that is the brute-force signal', async () => {
    await request(app).post('/api/auth/login')
      .send({ email: 'nobody@iinvsys.test', password: 'x' });
    expect(await AuditLog.countDocuments({ action: 'auth.login_failed' })).toBe(1);
  });

  it('never stores the attempted password', async () => {
    await request(app).post('/api/auth/login')
      .send({ email: 'nobody@iinvsys.test', password: 'Sup3rSecret!' });
    const all = await AuditLog.find().lean();
    expect(JSON.stringify(all)).not.toContain('Sup3rSecret');
  });
});

describe('destructive operations leave a snapshot', () => {
  it('DELETE /api/leads/:id records what was destroyed', async () => {
    const lead = await mkLead({ company: 'Sharma Industries', value: 250000 });

    expect((await auth(request(app).delete(`/api/leads/${lead._id}`))).status).toBe(200);
    expect(await Lead.countDocuments()).toBe(0);

    const e = await AuditLog.findOne({ action: 'record.delete', entityType: 'lead' }).lean();
    expect(e).not.toBeNull();
    expect(e.meta.snapshot).toMatchObject({
      name: 'Rajesh Kumar', phone: '9876543210', company: 'Sharma Industries', value: 250000,
    });
    expect(e.actor.name).toBe('Root');
  });

  it('merging records the source lead that the merge destroys', async () => {
    const target = await mkLead({ company: 'Sharma Industries' });
    const source = await mkLead({ name: 'R. Kumar', phone: '9876543211', company: 'Sharma Ind.' });

    const res = await auth(request(app).post(`/api/leads/${target._id}/merge`))
      .send({ sourceId: String(source._id) });
    expect(res.status).toBe(200);
    expect(await Lead.countDocuments()).toBe(1);

    const e = await AuditLog.findOne({ action: 'record.merge' }).lean();
    expect(e).not.toBeNull();
    expect(e.meta.sourceSnapshot).toMatchObject({ name: 'R. Kumar', phone: '9876543211' });
    expect(e.meta.targetId).toBe(String(target._id));
  });

  it('hard-deleting an agent records the linked user and orphaned leads', async () => {
    const agent = await Agent.create({
      name: 'Priya Nair', initials: 'PN', email: 'priya@iinvsys.test',
      phone: '9876543210', territory: 'West',
    });
    await mkLead({ assignedAgent: agent._id });
    await mkLead({ phone: '9876500000', assignedAgent: agent._id });

    const res = await auth(request(app).delete(`/api/agents/${agent._id}/hard`));
    expect(res.status).toBe(200);

    const e = await AuditLog.findOne({ action: 'record.delete', entityType: 'agent' }).lean();
    expect(e).not.toBeNull();
    expect(e.meta.snapshot).toMatchObject({ name: 'Priya Nair', territory: 'West', leadsUnassigned: 2 });
  });

  it('deleting an expo records how many leads it orphaned', async () => {
    const expo = await Expo.create({
      name: 'Mumbai Expo', startDate: new Date(), endDate: new Date(Date.now() + 86400000),
      venue: 'BEC', city: 'Mumbai',
    });
    await mkLead({ expo: expo._id, source: 'exhibition_event' });

    expect((await auth(request(app).delete(`/api/expos/${expo._id}`))).status).toBe(200);

    const e = await AuditLog.findOne({ action: 'record.delete', entityType: 'expo' }).lean();
    expect(e).not.toBeNull();
    expect(e.meta.snapshot).toMatchObject({ name: 'Mumbai Expo', orphanedLeads: 1 });
  });

  it('deleting a referrer records how many leads they captured', async () => {
    const expo = await Expo.create({
      name: 'Mumbai Expo', startDate: new Date(), endDate: new Date(Date.now() + 86400000),
      venue: 'BEC', city: 'Mumbai',
    });
    const ref = await User.create({
      name: 'Musthak', email: 'm@ref.iinvsys', password: 'TestPass@123',
      role: 'referrer', expoId: expo._id,
    });
    await mkLead({ createdBy: ref._id, expo: expo._id, source: 'exhibition_event' });

    const res = await auth(request(app).delete(`/api/expos/${expo._id}/referrers/${ref._id}`));
    expect(res.status).toBe(200);

    const e = await AuditLog.findOne({ action: 'record.delete', entityType: 'user' }).lean();
    expect(e).not.toBeNull();
    expect(e.meta.snapshot).toMatchObject({ name: 'Musthak', leadsCaptured: 1 });
  });
});

describe('the audit write never breaks the operation it records', () => {
  it('a delete still succeeds when the audit write fails', async () => {
    const lead = await mkLead();
    const spyErr = jest.spyOn(console, 'error').mockImplementation(() => {});
    const spy = jest.spyOn(AuditLog, 'create').mockRejectedValue(new Error('mongo down'));

    const res = await auth(request(app).delete(`/api/leads/${lead._id}`));

    expect(res.status).toBe(200);
    expect(await Lead.countDocuments()).toBe(0); // the business operation held
    expect(spyErr).toHaveBeenCalledWith(expect.stringContaining('AUDIT WRITE FAILED'));

    spy.mockRestore();
    spyErr.mockRestore();
  });
});
