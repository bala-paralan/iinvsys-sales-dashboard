'use strict';
/**
 * Delivery routes — B2b. (D-2, D-4, D-6, D-9, A11, A12, A24)
 *
 * The two properties that carry the KPIs:
 *   · noticeHours is measured against the ORIGINAL committed date, so
 *     repeated small revisions cannot reset the 48-hour clock (A12).
 *   · The DA gate refuses `delivered` without the signed acknowledgement AND
 *     its photo — the framework's "mandatory contractual record" (D-6).
 */
const request   = require('supertest');
const app       = require('../src/app');
const WorkOrder = require('../src/models/WorkOrder');
const Lead      = require('../src/models/Lead');
const Notification = require('../src/models/Notification');
const handoff   = require('../src/services/processHandoffService');
const sweeps    = require('../src/utils/jobs/deliverySweeps');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

let dmToken, warehouseToken, agentToken, managerId;

const daysFromNow = (n) => new Date(Date.now() + n * 86400000);

/** A Work Order as Handoff 1 produces it, with items so the D2 gate can pass. */
async function mkWorkOrder(over = {}) {
  const lead = await Lead.create({
    name: 'Rajesh Kumar', phone: `98765${Math.floor(10000 + Math.random() * 89999)}`,
    source: 'exhibition_event', stage: 'commercial_order',
    company: 'Sharma Industries', state: 'Maharashtra', poNumber: 'PO-114', value: 250000,
  });
  const wo = await handoff.createWorkOrderForLead(lead);
  if (Object.keys(over).length) { Object.assign(wo, over); await wo.save(); }
  if (!wo.items.length) { wo.items.push({ name: 'Smart Gateway', quantity: 2 }); await wo.save(); }
  return wo;
}

const as = (token) => ({
  post: (path, body) => request(app).post(`/api/workorders${path}`)
    .set('Authorization', `Bearer ${token}`).send(body),
  get: (path) => request(app).get(`/api/workorders${path}`)
    .set('Authorization', `Bearer ${token}`),
});

beforeAll(connect);
afterAll(disconnect);
beforeEach(async () => {
  await clearCollections();
  dmToken = tok(await insertUser({ role: 'production_head', name: 'Dev' }));
  warehouseToken = tok(await insertUser({ role: 'production_engineer', name: 'Ware' }));
  agentToken = tok(await insertUser({ role: 'sales_executive', name: 'Rahul' }));
  /* The A11 sweeps address holders of `workorder.accept` — the Production Head. */
  managerId = await insertUser({ role: 'production_head', name: 'Prod Head' });
});

describe('permissions — the matrix from doc 04, enforced', () => {
  it('a delivery manager reads work orders without holding any sales permission', async () => {
    await mkWorkOrder();
    const res = await as(dmToken).get('/');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('an agent sees ONLY work orders from their own deals — doc 04 scoped read', async () => {
    /* One WO from someone else's deal… */
    const other = await mkWorkOrder();
    /* …and one from the agent's own book. */
    const Agent = require('./helpers/owner');
    const me = await Agent.create({
      name: 'Rahul', initials: 'RS', email: 'rahul@iinvsys.test',
      phone: '9876500001', territory: 'West',
    });
    /* The SAME record — `Agent` is retired, so the profile IS the login. Creating a
       second user here gives them a scope that owns none of the leads below. */
    const agentUid = me._id;
    const myLead = await Lead.create({
      name: 'My Customer', phone: '9876511111', source: 'cold_call',
      stage: 'commercial_order', owner: me._id, poNumber: 'PO-MINE', value: 1000,
    });
    const mine = await handoff.createWorkOrderForLead(myLead);

    const res = await as(tok(agentUid)).get('/');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].woNumber).toBe(mine.woNumber);

    /* Someone else's WO answers 404, not 403 — ids cannot be probed. */
    expect((await as(tok(agentUid)).get(`/${other._id}`)).status).toBe(404);
  });

  it('warehouse can advance but cannot accept', async () => {
    const wo = await mkWorkOrder();
    expect((await as(warehouseToken).post(`/${wo._id}/accept`)).status).toBe(403);
    /* advance is permitted for warehouse (gate outcome is a separate matter) */
    const adv = await as(warehouseToken).post(`/${wo._id}/advance`, { toStage: 'procurement' });
    expect(adv.status).not.toBe(403);
  });

  it('the response never populates the lead — the snapshot is the customer record (A24)', async () => {
    const wo = await mkWorkOrder();
    const res = await as(dmToken).get(`/${wo._id}`);
    expect(typeof res.body.data.lead).toBe('string'); // an id, never a document
    expect(res.body.data.customerSnapshot.company).toBe('Sharma Industries');
  });
});

describe('accept and commit-date — the two A11 clocks', () => {
  it('accepting stamps the acceptor and starts clock #2', async () => {
    const wo = await mkWorkOrder();
    const res = await as(dmToken).post(`/${wo._id}/accept`);
    expect(res.status).toBe(200);
    expect(res.body.data.acceptedAt).toBeTruthy();
    expect(res.body.data.status).toBe('accepted');
  });

  it('accept is idempotent — a double click is not an error', async () => {
    const wo = await mkWorkOrder();
    await as(dmToken).post(`/${wo._id}/accept`);
    const again = await as(dmToken).post(`/${wo._id}/accept`);
    expect(again.status).toBe(200);
    expect(again.body.message).toMatch(/already accepted/i);
  });

  it('refuses to commit a date before acceptance', async () => {
    const wo = await mkWorkOrder();
    const res = await as(dmToken).post(`/${wo._id}/commit-date`, { date: daysFromNow(7) });
    expect(res.status).toBe(400);
  });

  it('commits the first date once, with customer acknowledgement', async () => {
    const wo = await mkWorkOrder();
    await as(dmToken).post(`/${wo._id}/accept`);
    const res = await as(dmToken).post(`/${wo._id}/commit-date`, {
      date: daysFromNow(7), ackMethod: 'phone',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.originalCommittedDate).toBeTruthy();
    expect(res.body.data.customerAck).toMatchObject({ acknowledged: true, method: 'phone' });
  });

  it('a SECOND commit-date is refused — changes go through /delay (A12)', async () => {
    const wo = await mkWorkOrder();
    await as(dmToken).post(`/${wo._id}/accept`);
    await as(dmToken).post(`/${wo._id}/commit-date`, { date: daysFromNow(7) });

    const res = await as(dmToken).post(`/${wo._id}/commit-date`, { date: daysFromNow(14) });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/delay/);
  });
});

describe('delay logging — D-4, D-9, A12', () => {
  async function committedWO(daysOut) {
    const wo = await mkWorkOrder();
    await as(dmToken).post(`/${wo._id}/accept`);
    await as(dmToken).post(`/${wo._id}/commit-date`, { date: daysFromNow(daysOut) });
    return wo;
  }

  it('requires a reason code — free text is not a reason (D-4)', async () => {
    const wo = await committedWO(7);
    const res = await as(dmToken).post(`/${wo._id}/delay`, {
      reasonCode: 'because reasons', revisedDate: daysFromNow(14),
    });
    expect(res.status).toBe(422);
  });

  it('records a compliant delay with noticeHours against the original date', async () => {
    const wo = await committedWO(7);
    const res = await as(dmToken).post(`/${wo._id}/delay`, {
      reasonCode: 'stock_unavailable', revisedDate: daysFromNow(14),
    });

    expect(res.status).toBe(200);
    const e = res.body.data.delayEvents[0];
    expect(e.reasonCode).toBe('stock_unavailable');
    expect(e.noticeHours).toBeGreaterThanOrEqual(7 * 24 - 1);
    expect(e.lateNotice).toBe(false);
    expect(new Date(res.body.data.currentCommittedDate).getTime())
      .toBeGreaterThan(new Date(res.body.data.originalCommittedDate).getTime());
  });

  it('a delay inside 48h is RECORDED as a breach, never rejected (D-9)', async () => {
    const wo = await committedWO(1); // tomorrow → ~24h notice
    const res = await as(dmToken).post(`/${wo._id}/delay`, {
      reasonCode: 'logistics_delay', revisedDate: daysFromNow(3),
    });

    expect(res.status).toBe(200);                       // recorded…
    expect(res.body.data.delayEvents[0].lateNotice).toBe(true); // …and named
    expect(res.body.message).toMatch(/BREACH/);

    const n = await Notification.findOne({ event: 'delivery.delay_late_notice' }).lean();
    expect(n).not.toBeNull();
    expect(n.severity).toBe('critical');
  });

  it('A12: a second delay still measures against the ORIGINAL date', async () => {
    const wo = await committedWO(7);
    /* First revision pushes the current date far out… */
    await as(dmToken).post(`/${wo._id}/delay`, {
      reasonCode: 'stock_unavailable', revisedDate: daysFromNow(30),
    });
    /* …if the clock followed revisions, this second delay would have ~30 days
       of notice. Against the ORIGINAL it has ~7. */
    const res = await as(dmToken).post(`/${wo._id}/delay`, {
      reasonCode: 'customer_requested', revisedDate: daysFromNow(45),
    });

    const second = res.body.data.delayEvents[1];
    expect(second.noticeHours).toBeLessThanOrEqual(7 * 24);
    expect(second.noticeHours).toBeGreaterThan(6 * 24);
  });
});

describe('stage advance — the shared transition contract over DELIVERY_STAGES', () => {
  it('refuses → procurement until accepted, dated, acknowledged and itemised', async () => {
    const wo = await mkWorkOrder();
    const res = await as(dmToken).post(`/${wo._id}/advance`, { toStage: 'procurement' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('STAGE_GATE_FAILED');
    const fields = res.body.missing.map((m) => m.field);
    expect(fields).toEqual(expect.arrayContaining(
      ['acceptedAt', 'currentCommittedDate', 'customerAck.acknowledged']));
  });

  it('passes once the D2 gate is satisfied, and refuses stage skips', async () => {
    const wo = await mkWorkOrder();
    await as(dmToken).post(`/${wo._id}/accept`);
    await as(dmToken).post(`/${wo._id}/commit-date`, { date: daysFromNow(7) });

    expect((await as(dmToken).post(`/${wo._id}/advance`, { toStage: 'scheduling_dispatch' })).body.code)
      .toBe('STAGE_SKIP');

    const res = await as(dmToken).post(`/${wo._id}/advance`, { toStage: 'procurement' });
    expect(res.status).toBe(200);
    expect(res.body.data.workOrder.stage).toBe('procurement');
    expect(res.body.data.workOrder.stageHistory).toHaveLength(2); // handoff + this
  });
});

describe('uploads and the DA gate — D-5, D-6', () => {
  async function uploadTo(woId, docType, buffer, filename, mime) {
    return request(app).post(`/api/workorders/${woId}/upload`)
      .set('Authorization', `Bearer ${dmToken}`)
      .field('docType', docType)
      .attach('file', buffer, { filename, contentType: mime });
  }

  it('stores a real file through fileStore and lists it on the record', async () => {
    const wo = await mkWorkOrder();
    const res = await uploadTo(wo._id, 'delivery_note', PDF, 'note.pdf', 'application/pdf');

    expect(res.status).toBe(201);
    expect(res.body.data.docType).toBe('delivery_note');
    expect(res.body.data.sha256).toHaveLength(64);

    const fresh = await WorkOrder.findById(wo._id).lean();
    expect(fresh.attachments).toHaveLength(1);
  });

  it('refuses a file whose bytes contradict its claimed type', async () => {
    const wo = await mkWorkOrder();
    const res = await uploadTo(wo._id, 'invoice', PNG, 'invoice.pdf', 'application/pdf');
    expect(res.status).toBe(422);
  });

  it('refuses an unknown docType', async () => {
    const wo = await mkWorkOrder();
    const res = await uploadTo(wo._id, 'meme', PDF, 'x.pdf', 'application/pdf');
    expect(res.status).toBe(422);
  });

  it('the DA gate refuses delivery without the acknowledgement AND its photo', async () => {
    const wo = await mkWorkOrder();
    await uploadTo(wo._id, 'delivery_acknowledgement', PDF, 'da.pdf', 'application/pdf');

    const res = await as(dmToken).post(`/${wo._id}/deliver`, { itemsDelivered: 2 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('DA_GATE_FAILED');
    expect(res.body.missing.map((m) => m.field)).toContain('attachments');
  });

  it('delivers once DA + photo + accuracy are on file, and fires Handoff 2', async () => {
    const wo = await mkWorkOrder();
    await uploadTo(wo._id, 'delivery_acknowledgement', PDF, 'da.pdf', 'application/pdf');
    await uploadTo(wo._id, 'da_photo', PNG, 'proof.png', 'image/png');

    const res = await as(dmToken).post(`/${wo._id}/deliver`, { itemsDelivered: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data.workOrder.status).toBe('delivered');
    expect(res.body.data.workOrder.deliveredAt).toBeTruthy();

    /* B3 replaced the stub: the signed DA now creates the Installation Job.
       Depth is covered by tests/24-installation.test.js; this asserts the
       delivery side of the seam still fires. */
    expect(res.body.data.installationJob.jobNumber).toMatch(/^IJ-\d{4}-\d{6}$/);
    expect(String((await WorkOrder.findById(wo._id)).installationJob))
      .toBe(String(res.body.data.installationJob._id));
  });
});

describe('the A11 sweeps track two separate clocks', () => {
  it('flags an unaccepted Work Order after 1 business day', async () => {
    const wo = await mkWorkOrder();
    await WorkOrder.collection.updateOne({ _id: wo._id }, { $set: { createdAt: new Date(Date.now() - 4 * 86400000) } });

    const r = await sweeps.unacceptedSweep();
    expect(r.flagged).toBe(1);
    /* Recipients resolve by permission: managers hold workorder.accept in the
       doc-04 matrix, so the acceptance clock reaches them too — alongside the
       handoff.workorder_created they already received at creation. */
    expect(await Notification.countDocuments({
      user: managerId, event: 'delivery.date_unconfirmed',
    })).toBe(1);
  });

  it('flags an accepted order with no committed date, to managers too', async () => {
    const wo = await mkWorkOrder();
    await as(dmToken).post(`/${wo._id}/accept`);
    await WorkOrder.updateOne({ _id: wo._id },
      { $set: { acceptedAt: new Date(Date.now() - 4 * 86400000) } }, { timestamps: false });

    const r = await sweeps.dateUnconfirmedSweep();
    expect(r.flagged).toBe(1);
    expect(await Notification.countDocuments({ user: managerId, event: 'delivery.date_unconfirmed' })).toBe(1);
  });

  it('is idempotent across repeated runs', async () => {
    const wo = await mkWorkOrder();
    await WorkOrder.collection.updateOne({ _id: wo._id }, { $set: { createdAt: new Date(Date.now() - 4 * 86400000) } });

    const first = await sweeps.unacceptedSweep();
    const second = await sweeps.unacceptedSweep();
    expect(first.notified).toBeGreaterThan(0);
    expect(second.notified).toBe(0);
    expect(second.suppressed).toBeGreaterThan(0);
  });

  it('flags nothing inside the SLA window', async () => {
    await mkWorkOrder();
    const r = await sweeps.runDeliverySweeps();
    expect(r.unaccepted.flagged).toBe(0);
    expect(r.dateUnconfirmed.flagged).toBe(0);
  });
});
