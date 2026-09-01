'use strict';
/**
 * AuditLog + auditService — R-7.
 *
 * The property that matters most here is append-only. A log the application can
 * rewrite is not evidence of anything, so every mutating path is asserted
 * closed — not just the one the code happens to use today.
 */
const mongoose = require('mongoose');
const AuditLog = require('../src/models/AuditLog');
const audit    = require('../src/services/auditService');
const { connect, disconnect, clearCollections } = require('./helpers/db');

const REQ = {
  user: { _id: new mongoose.Types.ObjectId(), name: 'Priya Nair', role: 'sales_director' },
  ip: '10.0.0.7',
  headers: { 'user-agent': 'jest' },
};

beforeAll(connect);
afterAll(disconnect);
beforeEach(clearCollections);

describe('append-only enforcement', () => {
  let entry;
  beforeEach(async () => {
    entry = await AuditLog.create({
      action: 'record.create', entityType: 'lead',
      entityId: new mongoose.Types.ObjectId(), summary: 'seed',
    });
  });

  it('rejects re-saving an existing document', async () => {
    entry.summary = 'tampered';
    await expect(entry.save()).rejects.toThrow(/append-only/i);
  });

  it.each([
    ['updateOne',        () => AuditLog.updateOne({}, { summary: 'x' })],
    ['updateMany',       () => AuditLog.updateMany({}, { summary: 'x' })],
    ['findOneAndUpdate', () => AuditLog.findOneAndUpdate({}, { summary: 'x' })],
    ['replaceOne',       () => AuditLog.replaceOne({}, { action: 'record.create', entityType: 'lead', summary: 'x' })],
    ['deleteOne',        () => AuditLog.deleteOne({})],
    ['deleteMany',       () => AuditLog.deleteMany({})],
    ['findOneAndDelete', () => AuditLog.findOneAndDelete({})],
  ])('rejects %s', async (_label, run) => {
    await expect(run()).rejects.toThrow(/append-only/i);
  });

  it('leaves the entry intact after every rejected attempt', async () => {
    const fresh = await AuditLog.findById(entry._id).lean();
    expect(fresh.summary).toBe('seed');
    expect(await AuditLog.countDocuments()).toBe(1);
  });

  it('still permits inserting new entries', async () => {
    await AuditLog.create({ action: 'record.create', entityType: 'lead', summary: 'second' });
    expect(await AuditLog.countDocuments()).toBe(2);
  });
});

describe('schema constraints', () => {
  it('rejects an action outside the vocabulary', async () => {
    await expect(AuditLog.create({
      action: 'record.frobnicate', entityType: 'lead', summary: 'x',
    })).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('rejects an unknown entity type', async () => {
    await expect(AuditLog.create({
      action: 'record.create', entityType: 'spaceship', summary: 'x',
    })).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('requires a human-readable summary', async () => {
    await expect(AuditLog.create({ action: 'record.create', entityType: 'lead' }))
      .rejects.toThrow(mongoose.Error.ValidationError);
  });
});

describe('auditService.record', () => {
  it('captures the actor and request fingerprint', async () => {
    await audit.record({ action: 'record.create', entityType: 'lead', summary: 'created' }, REQ);
    const e = await AuditLog.findOne().lean();
    expect(e.actor).toMatchObject({ name: 'Priya Nair', role: 'sales_director' });
    expect(String(e.actor.user)).toBe(String(REQ.user._id));
    expect(e.ip).toBe('10.0.0.7');
    expect(e.userAgent).toBe('jest');
  });

  it('works without a request — scheduled sweeps have no actor', async () => {
    await audit.record({ action: 'record.update', entityType: 'lead', summary: 'nightly sweep' });
    const e = await AuditLog.findOne().lean();
    expect(e.actor.user).toBeNull();
    expect(e.summary).toBe('nightly sweep');
  });

  it('NEVER throws into its caller when the write fails', async () => {
    /* An audit failure must not lose a customer's verified PO. */
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await audit.record(
      { action: 'not-a-real-action', entityType: 'lead', summary: 'bad' }, REQ);

    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('AUDIT WRITE FAILED'));
    expect(await AuditLog.countDocuments()).toBe(0);
    spy.mockRestore();
  });

  it('recordStrict DOES propagate, for write-or-fail call sites', async () => {
    await expect(audit.recordStrict(
      { action: 'not-a-real-action', entityType: 'lead', summary: 'bad' }, REQ))
      .rejects.toThrow();
  });
});

describe('typed helpers pin the meta shape', () => {
  it('stageTransition records from, to and direction', async () => {
    const id = new mongoose.Types.ObjectId();
    await audit.stageTransition({
      entityType: 'lead', entityId: id, from: 'prospect', to: 'engagement',
      direction: 'forward', note: 'demo done', label: 'Sharma Industries',
    }, REQ);

    const e = await AuditLog.findOne({ action: 'stage.transition' }).lean();
    expect(e.meta).toMatchObject({ from: 'prospect', to: 'engagement', direction: 'forward', note: 'demo done' });
    expect(e.summary).toContain('prospect → engagement');
  });

  it('a brand-new record logs from = null, not a fabricated stage', async () => {
    await audit.stageTransition({ entityType: 'lead', to: 'suspect' }, REQ);
    const e = await AuditLog.findOne().lean();
    expect(e.meta.from).toBeNull();
  });

  it('gateOverride preserves the exact waived list', async () => {
    await audit.gateOverride({
      entityType: 'lead', entityId: new mongoose.Types.ObjectId(),
      from: 'engagement', to: 'negotiation',
      missing: ['attachments.hasAnyDoc', 'nextAction.notEmpty'],
      note: 'customer signed offline', label: 'Sharma Industries',
    }, REQ);

    const e = await AuditLog.findOne({ action: 'stage.gate_override' }).lean();
    expect(e.meta.missingAtOverride).toEqual(['attachments.hasAnyDoc', 'nextAction.notEmpty']);
    expect(e.summary).toContain('2 requirement(s) waived');
    expect(e.meta.note).toBe('customer signed offline');
  });

  it('destruction snapshots what was lost', async () => {
    await audit.destruction({
      entityType: 'lead', entityId: new mongoose.Types.ObjectId(),
      snapshot: { name: 'Rajesh Kumar', phone: '9876543210' },
      reason: 'duplicate', label: 'Rajesh Kumar',
    }, REQ);

    const e = await AuditLog.findOne({ action: 'record.delete' }).lean();
    expect(e.meta.snapshot).toEqual({ name: 'Rajesh Kumar', phone: '9876543210' });
    expect(e.meta.reason).toBe('duplicate');
  });

  it('ruleChange records both sides of a threshold move', async () => {
    await audit.ruleChange({ key: 'pipeline.spenco.minTotal', before: 18, after: 24 }, REQ);
    const e = await AuditLog.findOne({ action: 'settings.rule_change' }).lean();
    expect(e.meta).toMatchObject({ key: 'pipeline.spenco.minTotal', before: 18, after: 24 });
  });

  it('roleChange records both sides', async () => {
    await audit.roleChange({
      userId: new mongoose.Types.ObjectId(), name: 'Amit', before: 'sales_executive', after: 'sales_director',
    }, REQ);
    const e = await AuditLog.findOne({ action: 'user.role_change' }).lean();
    expect(e.meta).toMatchObject({ before: 'sales_executive', after: 'sales_director' });
  });
});

describe('sign-in logging', () => {
  it('records a successful sign-in against the account', async () => {
    const id = new mongoose.Types.ObjectId();
    await audit.login({ ok: true, email: 'a@iinvsys.test', userId: id, name: 'A', role: 'sales_executive' });
    const e = await AuditLog.findOne({ action: 'auth.login' }).lean();
    expect(String(e.actor.user)).toBe(String(id));
  });

  it('a FAILED sign-in is not attributed to the claimed account', async () => {
    /* Nobody proved that identity. Recording it as the actor would assert
       something the request never established. */
    await audit.login({ ok: false, email: 'victim@iinvsys.test', reason: 'invalid_credentials' });
    const e = await AuditLog.findOne({ action: 'auth.login_failed' }).lean();
    expect(e.actor.user).toBeNull();
    expect(e.actor.role).toBe('');
    expect(e.summary).toContain('victim@iinvsys.test');
  });

  it('never stores the attempted password', async () => {
    await audit.login({ ok: false, email: 'a@iinvsys.test', reason: 'invalid_credentials' });
    const e = await AuditLog.findOne().lean();
    expect(JSON.stringify(e)).not.toContain('password');
  });
});

describe('query patterns the audit UI needs', () => {
  it('returns an entity history newest-first', async () => {
    const id = new mongoose.Types.ObjectId();
    for (const [from, to] of [['suspect', 'prospect'], ['prospect', 'engagement']]) {
      await audit.stageTransition({ entityType: 'lead', entityId: id, from, to }, REQ);
    }
    await audit.stageTransition({ entityType: 'lead', entityId: new mongoose.Types.ObjectId(), from: 'a', to: 'b' }, REQ);

    const history = await AuditLog.find({ entityType: 'lead', entityId: id }).sort({ at: -1 }).lean();
    expect(history).toHaveLength(2);
    expect(history[0].meta.to).toBe('engagement');
  });
});
