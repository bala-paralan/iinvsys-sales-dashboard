'use strict';

/**
 * SPENCO CRM brief §5 — lead transfer / assignment rules.
 *
 *   | Sales Director         | Anyone in the system              |
 *   | Inside Sales Manager   | ZSM, ASM                          |
 *   | Zonal Sales Manager    | ASM (within their zone)           |
 *   | Area Sales Manager     | SE (within their area)            |
 *   | Inside Sales Executive | Cannot transfer — escalates to ISM|
 *   | Sales Executive        | Cannot transfer — escalates to ASM|
 *
 * Every row is asserted in BOTH directions. A rule tested only by its refusal case is
 * indistinguishable from a rule that refuses everyone — that exact bug shipped once
 * (scopeAllows vs a populated owner) and its test was green.
 */

const request = require('supertest');
const app = require('../src/app');
const Lead = require('../src/models/Lead');
const Approval = require('../src/models/Approval');
const Notification = require('../src/models/Notification');
const AuditLog = require('../src/models/AuditLog');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const roles = require('./helpers/roles');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function dealFor(owner, extra = {}) {
  return Lead.create({
    name: 'Rajesh Kumar', phone: '9100000041', company: 'DMRC Delhi',
    source: 'referral', track: 'sales', refId: `SA-2026-${Math.floor(Math.random() * 9000) + 1000}`,
    stage: 'prospect', owner, value: 4800000, ...extra,
  });
}

async function isLeadFor(owner, extra = {}) {
  return Lead.create({
    name: 'Meena S', phone: '9100000099', company: 'Ashok Leyland',
    source: 'inside_sales_outbound', track: 'inside_sales', isStage: 'is_contacted',
    refId: `IS-2026-${Math.floor(Math.random() * 9000) + 1000}`, owner, ...extra,
  });
}

const transfer = (lead, actor, to, note = '') =>
  request(app).post(`/api/leads/${lead._id}/transfer`).set(auth(actor.token)).send({ to, note });

describe('lead transfers — SPENCO CRM brief §5', () => {
  beforeAll(connect);
  afterAll(disconnect);
  beforeEach(clearCollections);

  /* ── Sales Director: anyone ─────────────────────────────────────────────── */
  describe('Sales Director', () => {
    it('transfers a deal to anyone in Sales, across zones', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.execA.id);

      for (const target of [o.southA.execA, o.south, o.northB.manager]) {
        const res = await transfer(deal, o.director, target.id);
        expect(res.status).toBe(200);
        expect(String((await Lead.findById(deal._id)).owner)).toBe(String(target.id));
      }
    });

    it('moves an Inside Sales lead between IS people without minting a deal', async () => {
      const o = await roles.salesOrg();
      const ise2 = await roles.asISE({ reportsTo: o.ism.id });
      const lead = await isLeadFor(o.ise.id);

      const res = await transfer(lead, o.director, ise2.id);
      expect(res.status).toBe(200);
      expect(res.body.data.crossedTrack).toBe(false);
      expect(await Lead.countDocuments({ track: 'sales' })).toBe(0);
      expect(String((await Lead.findById(lead._id)).owner)).toBe(String(ise2.id));
    });

    it('refuses to send a Sales deal back to Inside Sales — no such move exists', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.execA.id);
      const res = await transfer(deal, o.director, o.ise.id);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/may only transfer to/);
    });
  });

  /* ── Inside Sales Manager: ZSM or ASM ───────────────────────────────────── */
  describe('Inside Sales Manager', () => {
    it('hands an IS lead to a ZSM — minting the SPENCO deal exactly once', async () => {
      const o = await roles.salesOrg();
      const lead = await isLeadFor(o.ise.id, { isStage: 'is_qualified' });

      const res = await transfer(lead, o.ism, o.north.id, 'Big account, needs zone attention');
      expect(res.status).toBe(200);
      expect(res.body.data.crossedTrack).toBe(true);
      expect(res.body.data.salesLead.track).toBe('sales');
      expect(res.body.data.salesLead.stage).toBe('prospect');
      expect(String(res.body.data.salesLead.owner)).toBe(String(o.north.id));

      const origin = await Lead.findById(lead._id);
      expect(origin.isStage).toBe('is_converted');
      expect(String(origin.convertedTo)).toBe(String(res.body.data.salesLead._id));
      expect(await Lead.countDocuments({ track: 'sales' })).toBe(1);

      /* Both records carry the hand-over in their ownership log. */
      expect(origin.transferHistory.at(-1)).toMatchObject({ kind: 'transferred', toName: expect.any(String) });
      const deal = await Lead.findById(res.body.data.salesLead._id);
      expect(deal.transferHistory.map((t) => t.kind)).toEqual(['created', 'transferred']);
      expect(String(deal.transferHistory[1].by)).toBe(String(o.ism.id));
    });

    it('hands an IS lead to an ASM', async () => {
      const o = await roles.salesOrg();
      const lead = await isLeadFor(o.ise.id);
      const res = await transfer(lead, o.ism, o.northA.manager.id);
      expect(res.status).toBe(200);
      /* Not yet BANT-qualified → enters at Suspect, not Prospect. */
      expect(res.body.data.salesLead.stage).toBe('suspect');
    });

    it('cannot hand an IS lead straight to a Sales Executive', async () => {
      const o = await roles.salesOrg();
      const lead = await isLeadFor(o.ise.id);
      const res = await transfer(lead, o.ism, o.northA.execA.id);
      expect(res.status).toBe(400);
      expect(await Lead.countDocuments({ track: 'sales' })).toBe(0);
    });

    it('cannot touch a lead outside their team', async () => {
      const o = await roles.salesOrg();
      const otherIsm = await roles.asISM({ reportsTo: o.director.id });
      const otherIse = await roles.asISE({ reportsTo: otherIsm.id });
      const lead = await isLeadFor(otherIse.id);
      const res = await transfer(lead, o.ism, o.north.id);
      expect(res.status).toBe(403);
    });

    it('still routes within the IS team through the assign endpoint, and logs it', async () => {
      const o = await roles.salesOrg();
      const ise2 = await roles.asISE({ reportsTo: o.ism.id });
      const lead = await isLeadFor(o.ise.id);

      const res = await request(app).post(`/api/is/leads/${lead._id}/assign`)
        .set(auth(o.ism.token)).send({ assignTo: ise2.id, note: 'Balancing load' });
      expect(res.status).toBe(200);
      const after = await Lead.findById(lead._id);
      expect(String(after.owner)).toBe(String(ise2.id));
      expect(after.transferHistory.at(-1)).toMatchObject({ kind: 'transferred', note: 'Balancing load' });
      expect(String(after.transferHistory.at(-1).from)).toBe(String(o.ise.id));
    });

    it('the assign endpoint hands to a ZSM through the same engine', async () => {
      const o = await roles.salesOrg();
      const lead = await isLeadFor(o.ise.id);
      const res = await request(app).post(`/api/is/leads/${lead._id}/assign`)
        .set(auth(o.ism.token)).send({ assignTo: o.north.id });
      expect(res.status).toBe(200);
      expect(res.body.data.salesLead.track).toBe('sales');
    });
  });

  /* ── Zonal Sales Manager: ASM within their zone ─────────────────────────── */
  describe('Zonal Sales Manager', () => {
    it('reassigns between ASMs in their own zone', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.manager.id);
      const res = await transfer(deal, o.north, o.northB.manager.id);
      expect(res.status).toBe(200);
      expect(String((await Lead.findById(deal._id)).owner)).toBe(String(o.northB.manager.id));
    });

    it('cannot reach an ASM in another zone', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.manager.id);
      const res = await transfer(deal, o.north, o.southA.manager.id);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/not in your zone/);
    });

    it('cannot hand a deal straight to an SE, even their own zone\'s', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.manager.id);
      const res = await transfer(deal, o.north, o.northA.execA.id);
      expect(res.status).toBe(400);
    });

    it('cannot act on a deal owned in another zone', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.southA.manager.id);
      const res = await transfer(deal, o.north, o.northA.manager.id);
      expect(res.status).toBe(403);
    });
  });

  /* ── Area Sales Manager: SE within their area ───────────────────────────── */
  describe('Area Sales Manager', () => {
    it('reassigns between their own SEs', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.execA.id);
      const res = await transfer(deal, o.northA.manager, o.northA.execB.id, 'Territory realignment');
      expect(res.status).toBe(200);
      const after = await Lead.findById(deal._id);
      expect(String(after.owner)).toBe(String(o.northA.execB.id));
      expect(after.transferHistory.at(-1)).toMatchObject({
        kind: 'transferred', note: 'Territory realignment',
      });
      expect(String(after.transferHistory.at(-1).from)).toBe(String(o.northA.execA.id));
      expect(String(after.transferHistory.at(-1).by)).toBe(String(o.northA.manager.id));
    });

    it('cannot reach an SE in another area, even the same zone', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.execA.id);
      const res = await transfer(deal, o.northA.manager, o.northB.execA.id);
      expect(res.status).toBe(403);
    });

    it('cannot hand a deal up to another ASM', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.execA.id);
      const res = await transfer(deal, o.northA.manager, o.northB.manager.id);
      expect(res.status).toBe(400);
    });

    it('notifies the new owner and writes an audit row', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.execA.id);
      await transfer(deal, o.northA.manager, o.northA.execB.id, 'Yours now');
      const n = await Notification.findOne({ user: o.northA.execB.id, event: 'lead.assigned' }).lean();
      expect(n).toBeTruthy();
      expect(n.body).toBe('Yours now');
      const a = await AuditLog.findOne({ entityType: 'lead', entityId: deal._id, action: 'record.update' }).lean();
      expect(a.meta.to).toBe(String(o.northA.execB.id));
      expect(a.meta.from).toBe(String(o.northA.execA.id));
    });
  });

  /* ── Executives: cannot transfer, must escalate ─────────────────────────── */
  describe('Sales Executive and Inside Sales Executive', () => {
    it('are refused a transfer outright', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.execA.id);
      const se = await transfer(deal, o.northA.execA, o.northA.execB.id);
      expect(se.status).toBe(403);
      expect(se.body.message).toMatch(/cannot transfer/);

      const lead = await isLeadFor(o.ise.id);
      const ise = await transfer(lead, o.ise, o.north.id);
      expect(ise.status).toBe(403);
    });

    it('see an empty target list, so the client offers escalation instead', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.execA.id);
      const res = await request(app).get(`/api/leads/${deal._id}/transfer-targets`).set(auth(o.northA.execA.token));
      expect(res.status).toBe(200);
      expect(res.body.data.canTransfer).toBe(false);
      expect(res.body.data.targets).toEqual([]);
    });

    it('an SE raises a transfer request that lands on their ASM', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.execA.id);
      const res = await request(app).post(`/api/leads/${deal._id}/request-transfer`)
        .set(auth(o.northA.execA.token)).send({ reason: 'Customer moved to Chennai', suggestedTo: o.northA.execB.id });
      expect(res.status).toBe(201);
      expect(res.body.data.kind).toBe('transfer');
      expect(String(res.body.data.assignedTo)).toBe(String(o.northA.manager.id));
      expect(String((await Lead.findById(deal._id)).owner)).toBe(String(o.northA.execA.id));  // unchanged
    });

    it('refuses a request with no reason, and a second one while the first waits', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.execA.id);
      const none = await request(app).post(`/api/leads/${deal._id}/request-transfer`)
        .set(auth(o.northA.execA.token)).send({});
      expect(none.status).toBe(400);
      await request(app).post(`/api/leads/${deal._id}/request-transfer`)
        .set(auth(o.northA.execA.token)).send({ reason: 'x' });
      const dup = await request(app).post(`/api/leads/${deal._id}/request-transfer`)
        .set(auth(o.northA.execA.token)).send({ reason: 'y' });
      expect(dup.status).toBe(400);
      expect(dup.body.message).toMatch(/already waiting/);
    });

    it('the ASM approving the request moves the deal — under the ASM\'s own rule', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.execA.id);
      await request(app).post(`/api/leads/${deal._id}/request-transfer`)
        .set(auth(o.northA.execA.token)).send({ reason: 'Customer moved', suggestedTo: o.northA.execB.id });
      const approval = await Approval.findOne({ kind: 'transfer' });

      /* Not the assignee: the other zone's ASM cannot decide it. */
      const wrong = await request(app).post(`/api/leads/transfer-requests/${approval._id}/decide`)
        .set(auth(o.southA.manager.token)).send({ status: 'approved' });
      expect(wrong.status).toBe(403);

      /* The ASM cannot approve it TO an SE outside their area. */
      const outside = await request(app).post(`/api/leads/transfer-requests/${approval._id}/decide`)
        .set(auth(o.northA.manager.token)).send({ status: 'approved', to: o.northB.execA.id });
      expect(outside.status).toBe(403);
      expect((await Approval.findById(approval._id)).status).toBe('pending');

      const res = await request(app).post(`/api/leads/transfer-requests/${approval._id}/decide`)
        .set(auth(o.northA.manager.token)).send({ status: 'approved' });
      expect(res.status).toBe(200);
      expect(String((await Lead.findById(deal._id)).owner)).toBe(String(o.northA.execB.id));
      expect((await Approval.findById(approval._id)).status).toBe('approved');
    });

    it('returning the request leaves the deal where it is', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.execA.id);
      await request(app).post(`/api/leads/${deal._id}/request-transfer`)
        .set(auth(o.northA.execA.token)).send({ reason: 'Customer moved' });
      const approval = await Approval.findOne({ kind: 'transfer' });
      const res = await request(app).post(`/api/leads/transfer-requests/${approval._id}/decide`)
        .set(auth(o.northA.manager.token)).send({ status: 'returned', note: 'Keep it, follow up first' });
      expect(res.status).toBe(200);
      expect(String((await Lead.findById(deal._id)).owner)).toBe(String(o.northA.execA.id));
    });

    it('the generic approvals endpoint moves the deal too — no door skips the engine', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.execA.id);
      await request(app).post(`/api/leads/${deal._id}/request-transfer`)
        .set(auth(o.northA.execA.token)).send({ reason: 'Customer moved', suggestedTo: o.northA.execB.id });
      const approval = await Approval.findOne({ kind: 'transfer' });
      const res = await request(app).post(`/api/approvals/${approval._id}/decide`)
        .set(auth(o.northA.manager.token)).send({ status: 'approved' });
      expect(res.status).toBe(200);
      expect(String((await Lead.findById(deal._id)).owner)).toBe(String(o.northA.execB.id));
    });
  });

  /* ── The door that had no rule ──────────────────────────────────────────── */
  describe('PUT /api/leads/:id', () => {
    it('refuses an owner change, even from the Director', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.execA.id);
      const res = await request(app).put(`/api/leads/${deal._id}`)
        .set(auth(o.director.token)).send({ owner: o.northA.execB.id });
      expect(res.status).toBe(422);
      expect(res.body.code || res.body.error?.code || JSON.stringify(res.body)).toMatch(/OWNER_CHANGE_VIA_TRANSFER/);
      expect(String((await Lead.findById(deal._id)).owner)).toBe(String(o.northA.execA.id));
    });

    it('treats an unchanged owner as a no-op, so an ordinary Save still works', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.execA.id);
      const res = await request(app).put(`/api/leads/${deal._id}`)
        .set(auth(o.director.token)).send({ owner: o.northA.execA.id, notes: 'Called today' });
      expect(res.status).toBe(200);
    });
  });

  /* ── The picker ─────────────────────────────────────────────────────────── */
  describe('GET /api/leads/:id/transfer-targets', () => {
    it('lists exactly the matrix row ∩ the caller\'s subtree, minus the current owner', async () => {
      const o = await roles.salesOrg();
      const deal = await dealFor(o.northA.execA.id);

      const asm = await request(app).get(`/api/leads/${deal._id}/transfer-targets`).set(auth(o.northA.manager.token));
      expect(asm.body.data.roles).toEqual(['sales_executive']);
      expect(asm.body.data.targets.map((u) => String(u._id))).toEqual([String(o.northA.execB.id)]);

      const zsm = await request(app).get(`/api/leads/${deal._id}/transfer-targets`).set(auth(o.north.token));
      expect(zsm.body.data.targets.map((u) => String(u._id)).sort())
        .toEqual([String(o.northA.manager.id), String(o.northB.manager.id)].sort());

      const lead = await isLeadFor(o.ise.id);
      const ism = await request(app).get(`/api/leads/${lead._id}/transfer-targets`).set(auth(o.ism.token));
      expect(ism.body.data.roles).toEqual(['zonal_sales_manager', 'area_sales_manager']);
      expect(ism.body.data.targets.map((u) => u.role)).toEqual(
        expect.arrayContaining(['zonal_sales_manager', 'area_sales_manager']),
      );
      expect(ism.body.data.targets.some((u) => u.role === 'sales_executive')).toBe(false);
    });
  });
});
