'use strict';
/**
 * Production & Delivery — ERP Bible V3, document 3.
 *
 * Doc 3 states two rules more emphatically than anything else in the specification, and
 * both are the kind that quietly stop holding:
 *
 *   "Engineers cannot mark an order as 'dispatch ready' — only the Production Head can do
 *    that after reviewing QC results. This is enforced at the backend level."
 *
 *   "Financial data is visible only to the Production Head and Sales Director. This is a
 *    backend access control — not just hidden in the UI but not sent to the engineer's
 *    session at all."
 *
 * The first is tested as TWO independent layers, because a single mechanism is a single
 * point of failure for a rule the document calls mandatory.
 */
const request = require('supertest');
const app = require('../src/app');
const WorkOrder = require('../src/models/WorkOrder');
const pipeline = require('../src/config/pipeline');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const roles = require('./helpers/roles');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function productionOrg() {
  const head = await roles.asProductionHead();
  const suresh = await roles.asProductionEngineer({ reportsTo: head.id });
  const ramesh = await roles.asProductionEngineer({ reportsTo: head.id });
  return { head, suresh, ramesh };
}

let woSeq = 0;
async function order(extra = {}) {
  woSeq += 1;
  return WorkOrder.create({
    woNumber: `WO-2026-${String(woSeq).padStart(6, '0')}`,
    lead: new (require('mongoose').Types.ObjectId)(),
    poNumber: 'PO-BEL-4471',
    poValue: 19800000,
    customerSnapshot: { name: 'K. Narayana', company: 'BEL Defence', city: 'Bangalore' },
    items: [{ name: 'IIoT Edge Gateway', sku: 'IIOT-EG-002', quantity: 4, unitPrice: 495000 }],
    stage: 'preparation_packing',
    ...extra,
  });
}

const PASSING_TESTS = [
  { parameter: 'Input voltage range', standard: '10–30V DC', result: '10.2 – 29.8V', status: 'pass' },
  { parameter: 'Operating temperature', standard: '-20 to +70C', result: '-22 to +71C', status: 'marginal' },
];

describe('Production & Delivery', () => {
  beforeAll(connect);
  afterAll(disconnect);
  beforeEach(clearCollections);

  describe('the QC gate — doc 3 PD-HD-07, "enforced at the backend level"', () => {
    it('LAYER 1: an engineer holds no workorder.dispatch', async () => {
      const o = await productionOrg();
      const wo = await order({ assignedEngineer: o.suresh.id, 'qc.approvedAt': new Date() });

      const res = await request(app).post(`/api/production/orders/${wo._id}/dispatch-auth`)
        .set(auth(o.suresh.token)).send({ mode: 'Air Cargo', awb: 'X1' });
      expect(res.status).toBe(403);
    });

    it('LAYER 2: the stage gate refuses dispatch without a Head\'s QC approval', async () => {
      const o = await productionOrg();
      const wo = await order({
        assignedEngineer: o.suresh.id,
        packingCheckedBy: 'Suresh R',
        attachments: ['packing_list', 'delivery_note', 'invoice'].map((docType) => ({
          docType, filename: `${docType}.pdf`, mimeType: 'application/pdf',
          sizeBytes: 10, driver: 'gridfs', storageKey: docType, sha256: 'x',
        })),
      });

      /* Everything else the dispatch stage needs is present. Only QC is missing, and the
         Head is the one asking — so this is the GATE refusing, not the permission. */
      const res = await request(app).post(`/api/workorders/${wo._id}/advance`)
        .set(auth(o.head.token)).send({ toStage: 'scheduling_dispatch' });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('STAGE_GATE_FAILED');
      expect(res.body.missing.map((m) => m.field)).toContain('qc.approvedAt');
    });

    it('passes the gate once the Head approves QC', async () => {
      const o = await productionOrg();
      const wo = await order({
        assignedEngineer: o.suresh.id,
        packingCheckedBy: 'Suresh R',
        attachments: ['packing_list', 'delivery_note', 'invoice'].map((docType) => ({
          docType, filename: `${docType}.pdf`, mimeType: 'application/pdf',
          sizeBytes: 10, driver: 'gridfs', storageKey: docType, sha256: 'x',
        })),
      });

      await request(app).post(`/api/production/orders/${wo._id}/qc`)
        .set(auth(o.suresh.token)).send({ tests: PASSING_TESTS, notes: 'within tolerance' });
      await request(app).post(`/api/production/orders/${wo._id}/qc/decide`)
        .set(auth(o.head.token)).send({ status: 'approved' });

      const res = await request(app).post(`/api/workorders/${wo._id}/advance`)
        .set(auth(o.head.token)).send({ toStage: 'scheduling_dispatch' });
      expect(res.status).toBe(200);
    });

    it('an engineer submits results but cannot approve them', async () => {
      const o = await productionOrg();
      const wo = await order({ assignedEngineer: o.suresh.id });

      const submit = await request(app).post(`/api/production/orders/${wo._id}/qc`)
        .set(auth(o.suresh.token)).send({ tests: PASSING_TESTS });
      expect(submit.status).toBe(200);

      const approve = await request(app).post(`/api/production/orders/${wo._id}/qc/decide`)
        .set(auth(o.suresh.token)).send({ status: 'approved' });
      expect(approve.status).toBe(403);

      const after = await WorkOrder.findById(wo._id);
      expect(after.qc.submittedAt).not.toBeNull();
      expect(after.qc.approvedAt).toBeNull();
    });

    it('a rejection needs a reason and sends the results back', async () => {
      const o = await productionOrg();
      const wo = await order({ assignedEngineer: o.suresh.id });
      await request(app).post(`/api/production/orders/${wo._id}/qc`)
        .set(auth(o.suresh.token)).send({ tests: PASSING_TESTS });

      const bare = await request(app).post(`/api/production/orders/${wo._id}/qc/decide`)
        .set(auth(o.head.token)).send({ status: 'rejected' });
      expect(bare.status).toBe(400);

      await request(app).post(`/api/production/orders/${wo._id}/qc/decide`)
        .set(auth(o.head.token)).send({ status: 'rejected', reason: 'Re-run the burn-in test' });

      const after = await WorkOrder.findById(wo._id);
      expect(after.qc.rejectedReason).toMatch(/burn-in/);
      /* Back to the engineer: the results no longer stand, so the Head's queue is clear. */
      expect(after.qc.submittedAt).toBeNull();
      expect(after.qc.approvedAt).toBeNull();
    });

    it('refuses dispatch authorisation before QC even to the Head', async () => {
      const o = await productionOrg();
      const wo = await order({ assignedEngineer: o.suresh.id });

      const res = await request(app).post(`/api/production/orders/${wo._id}/dispatch-auth`)
        .set(auth(o.head.token)).send({ mode: 'Air Cargo', awb: 'AWB-1' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/QC must be approved/i);
    });

    it('records the dispatch once QC is approved', async () => {
      const o = await productionOrg();
      const wo = await order({ assignedEngineer: o.suresh.id });
      await request(app).post(`/api/production/orders/${wo._id}/qc`)
        .set(auth(o.suresh.token)).send({ tests: PASSING_TESTS });
      await request(app).post(`/api/production/orders/${wo._id}/qc/decide`)
        .set(auth(o.head.token)).send({ status: 'approved' });

      const res = await request(app).post(`/api/production/orders/${wo._id}/dispatch-auth`)
        .set(auth(o.head.token))
        .send({ mode: 'Road – Courier (Blue Dart)', awb: 'BD-99231', cartons: 3, grossWeightKg: 42 });

      expect(res.status).toBe(200);
      const after = await WorkOrder.findById(wo._id);
      expect(after.dispatchAuth.awb).toBe('BD-99231');
      /* The v2 fields the delivery KPIs and the D5 gate read stay in step. */
      expect(after.dispatchedAt).not.toBeNull();
      expect(after.status).toBe('dispatched');
      expect(after.dispatchDetails.reference).toBe('BD-99231');
    });
  });

  describe('the engineer never receives money — doc 3, twice', () => {
    it('omits poValue and unitPrice from the list', async () => {
      const o = await productionOrg();
      await order({ assignedEngineer: o.suresh.id });

      const res = await request(app).get('/api/production/orders').set(auth(o.suresh.token));
      const body = JSON.stringify(res.body);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(body).not.toMatch(/poValue/);
      expect(body).not.toMatch(/unitPrice/);
      /* The parts of the job they DO need are all there. */
      expect(res.body.data[0].woNumber).toBeTruthy();
      expect(res.body.data[0].items[0].name).toBe('IIoT Edge Gateway');
    });

    it('omits them from the single order too', async () => {
      const o = await productionOrg();
      const wo = await order({
        assignedEngineer: o.suresh.id,
        bom: [{ part: 'IP67 Enclosure (ABS)', quantity: 50, unit: 'nos', unitPrice: 340 }],
      });

      const res = await request(app).get(`/api/production/orders/${wo._id}`).set(auth(o.suresh.token));
      const body = JSON.stringify(res.body);

      expect(body).not.toMatch(/poValue/);
      expect(body).not.toMatch(/unitPrice/);
      /* BOM quantities and part names ARE visible — doc 3 is explicit that pricing is
         what is hidden, not the bill of materials. */
      expect(body).toMatch(/IP67 Enclosure/);
      expect(res.body.data.bom[0].quantity).toBe(50);
    });

    it('gives the Production Head the values', async () => {
      const o = await productionOrg();
      const wo = await order({ assignedEngineer: o.suresh.id });

      const res = await request(app).get(`/api/production/orders/${wo._id}`).set(auth(o.head.token));
      expect(res.body.data.poValue).toBe(19800000);
    });
  });

  describe('engineers see only their own orders — doc 3 PD-ENG-01', () => {
    it('excludes another engineer\'s order from the list', async () => {
      const o = await productionOrg();
      await order({ assignedEngineer: o.suresh.id, poNumber: 'MINE' });
      await order({ assignedEngineer: o.ramesh.id, poNumber: 'THEIRS' });

      const res = await request(app).get('/api/production/orders').set(auth(o.suresh.token));
      expect(res.body.data.map((w) => w.poNumber)).toEqual(['MINE']);
    });

    it('answers 404 for another engineer\'s order so ids cannot be probed', async () => {
      const o = await productionOrg();
      const theirs = await order({ assignedEngineer: o.ramesh.id });

      const res = await request(app).get(`/api/production/orders/${theirs._id}`)
        .set(auth(o.suresh.token));
      expect(res.status).toBe(404);
    });

    it('gives the Head every order', async () => {
      const o = await productionOrg();
      await order({ assignedEngineer: o.suresh.id });
      await order({ assignedEngineer: o.ramesh.id });

      const res = await request(app).get('/api/production/orders').set(auth(o.head.token));
      expect(res.body.data).toHaveLength(2);
    });

    it('refuses the engineer workload screen to an engineer', async () => {
      const o = await productionOrg();
      expect((await request(app).get('/api/production/workload')
        .set(auth(o.suresh.token))).status).toBe(403);
    });
  });

  describe('WIP steps — PD-ENG-02', () => {
    it('the Head assigns an engineer and defines the steps', async () => {
      const o = await productionOrg();
      const wo = await order();

      const res = await request(app).post(`/api/production/orders/${wo._id}/assign`)
        .set(auth(o.head.token))
        .send({ engineer: o.suresh.id, wipSteps: [
          { label: 'PCB sourcing & inspection' },
          { label: 'Firmware flashing' },
        ] });

      expect(res.status).toBe(200);
      const after = await WorkOrder.findById(wo._id);
      expect(String(after.assignedEngineer)).toBe(String(o.suresh.id));
      expect(after.wipSteps).toHaveLength(2);
      expect(after.wipSteps[0].order).toBe(1);
      expect(after.wipSteps[0].status).toBe('pending');
    });

    it('refuses assignment to someone who is not a Production Engineer', async () => {
      const o = await productionOrg();
      const wo = await order();
      const director = await roles.asDirector();

      const res = await request(app).post(`/api/production/orders/${wo._id}/assign`)
        .set(auth(o.head.token)).send({ engineer: director.id });
      expect(res.status).toBe(400);
    });

    it('the engineer completes a step and the percentage moves', async () => {
      const o = await productionOrg();
      const wo = await order({
        assignedEngineer: o.suresh.id,
        wipSteps: [{ order: 1, label: 'A' }, { order: 2, label: 'B' }],
      });

      const res = await request(app)
        .patch(`/api/production/orders/${wo._id}/steps/${wo.wipSteps[0]._id}`)
        .set(auth(o.suresh.token)).send({ status: 'done' });

      expect(res.status).toBe(200);
      expect(res.body.data.wipPercent).toBe(50);
      const after = await WorkOrder.findById(wo._id);
      expect(String(after.wipSteps[0].completedBy)).toBe(String(o.suresh.id));
    });

    it('reports the percentage on the READ paths, not only after a write', async () => {
      /* The schema has a `wipPercent` virtual, but every read here is `.lean()` and
         mongoose does not evaluate virtuals on lean documents — `lean({virtuals:true})`
         needs a plugin that is not installed, so the option is silently ignored. The
         earlier assertion passed because PATCH returns a real document; the list and the
         detail page, which is where anyone actually sees this number, had no percentage
         at all. */
      const o = await productionOrg();
      await order({
        assignedEngineer: o.suresh.id,
        wipSteps: [
          { order: 1, label: 'A', status: 'done' },
          { order: 2, label: 'B', status: 'done' },
          { order: 3, label: 'C' }, { order: 4, label: 'D' },
        ],
      });

      const list = await request(app).get('/api/production/orders').set(auth(o.suresh.token));
      expect(list.body.data[0].wipPercent).toBe(50);

      const one = await request(app)
        .get(`/api/production/orders/${list.body.data[0]._id}`).set(auth(o.suresh.token));
      expect(one.body.data.wipPercent).toBe(50);
    });

    it('reports null rather than 0 when no steps are defined', async () => {
      /* 0% reads as "nothing done yet"; the truth is "nobody has said what to do". */
      const o = await productionOrg();
      await order({ assignedEngineer: o.suresh.id });
      const res = await request(app).get('/api/production/orders').set(auth(o.suresh.token));
      expect(res.body.data[0].wipPercent).toBeNull();
    });

    it('refuses a step on someone else\'s order', async () => {
      const o = await productionOrg();
      const wo = await order({
        assignedEngineer: o.ramesh.id,
        wipSteps: [{ order: 1, label: 'A' }],
      });

      const res = await request(app)
        .patch(`/api/production/orders/${wo._id}/steps/${wo.wipSteps[0]._id}`)
        .set(auth(o.suresh.token)).send({ status: 'done' });
      expect(res.status).toBe(403);
    });
  });

  describe('flagging an issue — PD-ENG-05', () => {
    it('records it against the order', async () => {
      const o = await productionOrg();
      const wo = await order({ assignedEngineer: o.suresh.id });

      const res = await request(app).post(`/api/production/orders/${wo._id}/issues`)
        .set(auth(o.suresh.token))
        .send({ description: 'Gasket batch is out of spec', severity: 'blocker' });

      expect(res.status).toBe(201);
      const after = await WorkOrder.findById(wo._id);
      expect(after.productionIssues).toHaveLength(1);
      expect(after.productionIssues[0].severity).toBe('blocker');
    });
  });

  describe('the QC gate is in the stage table, not only in code', () => {
    it('the dispatch stage declares qc.approvedAt', () => {
      const def = pipeline.stageDef(pipeline.DELIVERY_STAGES, 'scheduling_dispatch');
      expect(def.entryRequires.map((r) => r.field)).toContain('qc.approvedAt');
    });
  });
});
