'use strict';
/**
 * Handoff 1 — verified PO → Delivery Work Order. (S-9, H-1, H-3, A24, A12)
 *
 * The two properties this suite defends:
 *
 *   1. Reachability IS the enforcement (H-1): a Work Order comes into being
 *      only through the PO-gated commercial_order transition, so its existence
 *      is evidence of a verified PO upstream.
 *   2. Idempotency under retry (H-3): a double-submitted transition, or the
 *      nightly repair pass running after a success, must never mint a second
 *      Work Order for the same sale.
 */
const request   = require('supertest');
const app       = require('../src/app');
const Lead      = require('../src/models/Lead');
const WorkOrder = require('../src/models/WorkOrder');
const Notification = require('../src/models/Notification');
const AuditLog  = require('../src/models/AuditLog');
const handoff   = require('../src/services/handoffService');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');

let adminToken, managerId;

const soon = () => new Date(Date.now() + 14 * 86400000);

/** A lead one legal hop from Commercial Order, with the PO gate satisfied. */
const readyLead = (over = {}) => Lead.create({
  name: 'Rajesh Kumar', phone: `98765${Math.floor(10000 + Math.random() * 89999)}`,
  source: 'exhibition_event', stage: 'negotiation',
  jobTitle: 'Plant Operations Manager', company: 'Sharma Industries',
  companyType: 'homeowner', city: 'Pune', state: 'Maharashtra',
  nextAction: 'Verify PO', nextFollowUpDate: soon(), expectedCloseDate: soon(),
  value: 250000, poNumber: 'PO-2026-114', subscriptionOffered: 'yes',
  attachments: [{
    docType: 'po', filename: 'po.pdf', mimeType: 'application/pdf',
    sizeBytes: 1024, storageKey: 'k1',
  }],
  ...over,
});

const advance = (id, body = { toStage: 'commercial_order' }) =>
  request(app).post(`/api/leads/${id}/advance`)
    .set('Authorization', `Bearer ${adminToken}`).send(body);

beforeAll(connect);
afterAll(disconnect);
beforeEach(async () => {
  await clearCollections();
  adminToken = tok(await insertUser({ role: 'superadmin', name: 'Root' }));
  managerId = await insertUser({ role: 'manager', name: 'Sneha' });
});

describe('winning the deal creates the Work Order', () => {
  it('the commercial_order transition returns the new Work Order', async () => {
    const lead = await readyLead();
    const res = await advance(lead._id);

    expect(res.status).toBe(200);
    expect(res.body.data.workOrder).toBeDefined();
    expect(res.body.data.workOrder.woNumber).toMatch(/^WO-\d{4}-\d{6}$/);
    expect(res.body.data.workOrder.stage).toBe('order_review');
  });

  it('carries the PO, value and a customer snapshot — never a Lead populate (A24)', async () => {
    const lead = await readyLead();
    await advance(lead._id);

    const wo = await WorkOrder.findOne({ lead: lead._id }).lean();
    expect(wo.poNumber).toBe('PO-2026-114');
    expect(wo.poValue).toBe(250000);
    expect(wo.customerSnapshot).toMatchObject({
      name: 'Rajesh Kumar', company: 'Sharma Industries',
      city: 'Pune', state: 'Maharashtra', zone: 'west',
    });
  });

  it('the snapshot is frozen at handoff — editing the lead later does not change it', async () => {
    const lead = await readyLead();
    await advance(lead._id);

    await Lead.updateOne({ _id: lead._id }, { $set: { phone: '9111111111', company: 'Renamed Ltd' } });

    const wo = await WorkOrder.findOne({ lead: lead._id }).lean();
    expect(wo.customerSnapshot.company).toBe('Sharma Industries');
  });

  it('sets the back-pointer on the lead', async () => {
    const lead = await readyLead();
    await advance(lead._id);

    const after = await Lead.findById(lead._id).lean();
    const wo = await WorkOrder.findOne({ lead: lead._id }).lean();
    expect(String(after.workOrder)).toBe(String(wo._id));
  });

  it('notifies holders of workorder.accept, at critical severity', async () => {
    const lead = await readyLead();
    await advance(lead._id);

    const n = await Notification.findOne({ event: 'handoff.workorder_created', user: managerId }).lean();
    expect(n).not.toBeNull();
    expect(n.severity).toBe('critical');
    expect(n.body).toContain('1 business day');
  });

  it('writes a handoff audit entry', async () => {
    const lead = await readyLead();
    await advance(lead._id);
    const e = await AuditLog.findOne({ action: 'handoff.created' }).lean();
    expect(e).not.toBeNull();
    expect(e.meta.poNumber).toBe('PO-2026-114');
  });

  it('a transition that FAILS its gate creates nothing (H-1)', async () => {
    const lead = await readyLead({ attachments: [] });   // no PO document
    const res = await advance(lead._id);

    expect(res.status).toBe(422);
    expect(await WorkOrder.countDocuments()).toBe(0);
  });

  it('an ordinary forward transition creates nothing', async () => {
    const lead = await readyLead({ stage: 'suspect' });
    await advance(lead._id, { toStage: 'prospect' });
    expect(await WorkOrder.countDocuments()).toBe(0);
  });
});

describe('idempotency under retry (H-3)', () => {
  it('calling the handoff twice returns the SAME Work Order', async () => {
    const lead = await readyLead({ stage: 'commercial_order' });

    const first = await handoff.createWorkOrderForLead(lead);
    const second = await handoff.createWorkOrderForLead(await Lead.findById(lead._id));

    expect(String(second._id)).toBe(String(first._id));
    expect(await WorkOrder.countDocuments()).toBe(1);
  });

  it('survives the back-pointer being missing — the unique index is the backstop', async () => {
    const lead = await readyLead({ stage: 'commercial_order' });
    await handoff.createWorkOrderForLead(lead);

    /* Simulate the race: a second caller whose copy of the lead predates the
       back-pointer write. */
    const staleCopy = await Lead.findById(lead._id);
    staleCopy.workOrder = null;

    const second = await handoff.createWorkOrderForLead(staleCopy);
    expect(second).not.toBeNull();
    expect(await WorkOrder.countDocuments()).toBe(1);
  });

  it('the repair pass creates for orphaned wins and skips completed ones', async () => {
    /* One win whose handoff "failed" (no WO), one that succeeded. */
    const orphan = await readyLead({ stage: 'commercial_order' });
    const done = await readyLead({ stage: 'commercial_order' });
    await handoff.createWorkOrderForLead(done);

    const result = await handoff.ensureWorkOrderExists();

    expect(result).toEqual({ orphaned: 1, repaired: 1 });
    expect(await WorkOrder.countDocuments()).toBe(2);
    expect((await Lead.findById(orphan._id)).workOrder).not.toBeNull();
  });

  it('running the repair pass again is a no-op', async () => {
    const lead = await readyLead({ stage: 'commercial_order' });
    await handoff.ensureWorkOrderExists();
    const second = await handoff.ensureWorkOrderExists();

    expect(second).toEqual({ orphaned: 0, repaired: 0 });
    expect(await WorkOrder.countDocuments()).toBe(1);
  });
});

describe('a handoff failure never fails the sale (S-9)', () => {
  it('the transition still succeeds when Work Order creation throws', async () => {
    const lead = await readyLead();
    const spyErr = jest.spyOn(console, 'error').mockImplementation(() => {});
    const spy = jest.spyOn(WorkOrder, 'create').mockRejectedValue(new Error('mongo down'));

    const res = await advance(lead._id);

    expect(res.status).toBe(200);                       // the sale held
    expect(res.body.data.lead.stage).toBe('commercial_order');
    expect(res.body.data.workOrder).toBeUndefined();     // and nothing pretended otherwise
    expect(spyErr).toHaveBeenCalledWith(expect.stringContaining('HANDOFF 1 FAILED'));

    spy.mockRestore();
    spyErr.mockRestore();

    /* The gap is visible to the repair pass. */
    const repair = await handoff.ensureWorkOrderExists();
    expect(repair.repaired).toBe(1);
  });
});

describe('originalCommittedDate is write-once (A12)', () => {
  it('accepts the first commitment and refuses every later change', async () => {
    const lead = await readyLead({ stage: 'commercial_order' });
    const wo = await handoff.createWorkOrderForLead(lead);

    wo.originalCommittedDate = soon();
    wo.currentCommittedDate = soon();
    await wo.save();                                     // null → date: fine

    wo.originalCommittedDate = new Date(Date.now() + 30 * 86400000);
    await expect(wo.save()).rejects.toThrow(/write-once/);
  });

  it('currentCommittedDate stays movable — that is the pair’s whole point', async () => {
    const lead = await readyLead({ stage: 'commercial_order' });
    const wo = await handoff.createWorkOrderForLead(lead);

    wo.originalCommittedDate = soon();
    wo.currentCommittedDate = soon();
    await wo.save();

    wo.currentCommittedDate = new Date(Date.now() + 30 * 86400000);
    await expect(wo.save()).resolves.toBeDefined();
  });
});
