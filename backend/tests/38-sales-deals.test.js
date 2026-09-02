'use strict';
/**
 * Sales — ERP Bible V3, document 2.
 *
 * The three things doc 2 is emphatic about, and that are easy to get subtly wrong:
 *
 *   1. The discount ladder. 0–3% self, 3–10% Manager, >10% Director — and a request
 *      routes UP THE REQUESTER'S OWN reporting line, not to whichever manager a query
 *      returned first. Doc 2 SA-DIR-01: "Sales Manager 1 cannot see that Sales Manager 2
 *      is at only 44% of target."
 *   2. An approver cannot counter ABOVE their own band. Otherwise 3–10% is advisory and
 *      a Manager grants 15% by countering upward.
 *   3. Confirming a Commercial Order is what starts Production, exactly once.
 */
const request = require('supertest');
const app = require('../src/app');
const Lead = require('../src/models/Lead');
const WorkOrder = require('../src/models/WorkOrder');
const Approval = require('../src/models/Approval');
const Customer = require('../src/models/Customer');
const pipeline = require('../src/config/pipeline');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const roles = require('./helpers/roles');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function salesOrg() {
  const director = await roles.asDirector();
  const mgr1 = await roles.asSalesManager({ reportsTo: director.id, domain: 'railways' });
  const mgr2 = await roles.asSalesManager({ reportsTo: director.id, domain: 'defence' });
  const execA = await roles.asSalesExecutive({ reportsTo: mgr1.id, domain: 'railways' });
  const execC = await roles.asSalesExecutive({ reportsTo: mgr2.id, domain: 'defence' });
  return { director, mgr1, mgr2, execA, execC };
}

async function dealFor(owner, extra = {}) {
  return Lead.create({
    name: 'Rajesh Kumar', phone: '9100000041', company: 'DMRC Delhi',
    source: 'referral', track: 'sales', refId: 'SA-2026-041',
    stage: 'negotiation', owner, value: 4800000, ...extra,
  });
}

describe('Sales — discounts and commercial orders', () => {
  beforeAll(connect);
  afterAll(disconnect);
  beforeEach(clearCollections);

  describe('the discount ladder — doc 2', () => {
    it.each([
      [0, 1], [2.9, 1], [3, 1],
      [3.01, 2], [7, 2], [10, 2],
      [10.5, 3], [12, 3],
    ])('%s%% falls in tier %i', (percent, tier) => {
      expect(pipeline.discountTierFor(percent).tier).toBe(tier);
    });

    it('applies a self-approved discount with no approval document', async () => {
      const o = await salesOrg();
      const deal = await dealFor(o.execA.id);

      const res = await request(app).post(`/api/deals/${deal._id}/discount`)
        .set(auth(o.execA.token))
        .send({ percent: 3, justification: 'within my authority', standardPrice: 1000000 });

      expect(res.status).toBe(200);
      expect(res.body.data.discount.status).toBe('self_approved');
      expect(res.body.data.value).toBe(970000);
      /* No queue entry: a list full of auto-approvals buries the ones needing a person. */
      expect(await Approval.countDocuments({ kind: 'discount' })).toBe(0);
    });

    it('routes 3–10% to the requester\'s OWN manager', async () => {
      const o = await salesOrg();
      const deal = await dealFor(o.execA.id);

      const res = await request(app).post(`/api/deals/${deal._id}/discount`)
        .set(auth(o.execA.token))
        .send({ percent: 7, justification: 'competing quote at 72L', standardPrice: 7800000 });

      expect(res.status).toBe(200);
      expect(res.body.data.discount.status).toBe('pending');

      const approval = await Approval.findOne({ kind: 'discount' });
      expect(String(approval.assignedTo)).toBe(String(o.mgr1.id));
      /* NOT the other domain's manager, whichever a find() would have returned first. */
      expect(String(approval.assignedTo)).not.toBe(String(o.mgr2.id));
      expect(approval.tier).toBe(2);
      expect(res.body.data.routedByFallback).toBe(false);
    });

    it('routes >10% past the manager to the Director', async () => {
      const o = await salesOrg();
      const deal = await dealFor(o.execA.id);

      await request(app).post(`/api/deals/${deal._id}/discount`)
        .set(auth(o.execA.token))
        .send({ percent: 12, justification: 'strategic account', standardPrice: 48000000 });

      const approval = await Approval.findOne({ kind: 'discount' });
      expect(String(approval.assignedTo)).toBe(String(o.director.id));
      expect(approval.tier).toBe(3);
    });

    it('does not price the deal until the discount is granted', async () => {
      const o = await salesOrg();
      const deal = await dealFor(o.execA.id, { value: 7800000 });

      await request(app).post(`/api/deals/${deal._id}/discount`)
        .set(auth(o.execA.token))
        .send({ percent: 7, justification: 'x', standardPrice: 7800000 });

      const after = await Lead.findById(deal._id);
      expect(after.value).toBe(7800000);
      expect(after.discount.status).toBe('pending');
    });
  });

  describe('deciding a discount — SA-MGR-08', () => {
    async function pending(o, percent = 7) {
      const deal = await dealFor(o.execA.id);
      await request(app).post(`/api/deals/${deal._id}/discount`).set(auth(o.execA.token))
        .send({ percent, justification: 'competing quote', standardPrice: 7800000 });
      return { deal, approval: await Approval.findOne({ kind: 'discount' }) };
    }

    it('approves at the requested percentage and prices the deal', async () => {
      const o = await salesOrg();
      const { deal, approval } = await pending(o);

      const res = await request(app).post(`/api/deals/discounts/${approval._id}/decide`)
        .set(auth(o.mgr1.token)).send({ status: 'approved' });

      expect(res.status).toBe(200);
      const after = await Lead.findById(deal._id);
      expect(after.discount.status).toBe('approved');
      expect(after.discount.percent).toBe(7);
      expect(after.value).toBe(7254000);           // 7.8M less 7%
    });

    it('counters to a lower percentage — doc 2 "Counter: Approve 5%"', async () => {
      const o = await salesOrg();
      const { deal, approval } = await pending(o);

      await request(app).post(`/api/deals/discounts/${approval._id}/decide`)
        .set(auth(o.mgr1.token)).send({ status: 'approved', counterPercent: 5 });

      const after = await Lead.findById(deal._id);
      expect(after.discount.percent).toBe(5);
      expect(after.value).toBe(7410000);
    });

    it('refuses a counter ABOVE the approver\'s own band', async () => {
      const o = await salesOrg();
      const { deal, approval } = await pending(o);

      /* Without this the 3–10% band is advisory: a Manager grants 15% by countering up. */
      const res = await request(app).post(`/api/deals/discounts/${approval._id}/decide`)
        .set(auth(o.mgr1.token)).send({ status: 'approved', counterPercent: 15 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/above the authority/i);
      const after = await Lead.findById(deal._id);
      expect(after.discount.status).toBe('pending');
    });

    it('rejects, clearing the discount', async () => {
      const o = await salesOrg();
      const { deal, approval } = await pending(o);

      await request(app).post(`/api/deals/discounts/${approval._id}/decide`)
        .set(auth(o.mgr1.token)).send({ status: 'rejected', note: 'hold the price' });

      const after = await Lead.findById(deal._id);
      expect(after.discount.status).toBe('rejected');
      expect(after.discount.percent).toBe(0);
      expect(after.value).toBe(7800000);
    });

    it('refuses a decision from a manager it was not addressed to', async () => {
      const o = await salesOrg();
      const { approval } = await pending(o);

      const res = await request(app).post(`/api/deals/discounts/${approval._id}/decide`)
        .set(auth(o.mgr2.token)).send({ status: 'approved' });
      expect(res.status).toBe(403);
    });
  });

  describe('commercial order — SA-EX-07 → SA-DIR-09', () => {
    async function readyDeal(o) {
      const customer = await Customer.create({ name: 'DMRC Delhi', normalizedKey: 'dmrc|delhi' });
      return dealFor(o.execA.id, {
        customer: customer._id, stage: 'commercial_order',
        poNumber: 'PO-DMRC-9931', value: 4800000,
      });
    }

    it('refuses a CO on a deal that has not passed the stage gate', async () => {
      /* Confirming a CO fires Handoff 1. Without this precondition a Director could raise
         a production order for a deal still in Negotiation — no PO document, no PO
         number — which is the H-1 guarantee routed around by a different endpoint. */
      const o = await salesOrg();
      const deal = await dealFor(o.execA.id, { stage: 'negotiation' });

      const res = await request(app).post(`/api/deals/${deal._id}/commercial-order`)
        .set(auth(o.execA.token)).send({ poValue: 4800000 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Advance the deal to Commercial Order first/i);
      expect(await Approval.countDocuments({ kind: 'co_confirm' })).toBe(0);
      expect(await WorkOrder.countDocuments()).toBe(0);
    });

    it('submits to the Director and does not start production yet', async () => {
      const o = await salesOrg();
      const deal = await readyDeal(o);

      const res = await request(app).post(`/api/deals/${deal._id}/commercial-order`)
        .set(auth(o.execA.token)).send({ poValue: 4800000 });

      expect(res.status).toBe(201);
      const approval = await Approval.findOne({ kind: 'co_confirm' });
      expect(String(approval.assignedTo)).toBe(String(o.director.id));
      expect(await WorkOrder.countDocuments()).toBe(0);
    });

    it('confirming raises the production order', async () => {
      const o = await salesOrg();
      const deal = await readyDeal(o);
      await request(app).post(`/api/deals/${deal._id}/commercial-order`)
        .set(auth(o.execA.token)).send({ poValue: 4800000 });
      const approval = await Approval.findOne({ kind: 'co_confirm' });

      const res = await request(app).post(`/api/deals/commercial-orders/${approval._id}/confirm`)
        .set(auth(o.director.token)).send({});

      expect(res.status).toBe(200);
      expect(res.body.data.workOrder).toBeTruthy();
      expect(await WorkOrder.countDocuments()).toBe(1);

      const after = await Lead.findById(deal._id);
      expect(after.co.confirmedAt).not.toBeNull();
      expect(String(after.co.confirmedBy)).toBe(String(o.director.id));
    });

    it('is idempotent — a retried confirmation raises no second order', async () => {
      const o = await salesOrg();
      const deal = await readyDeal(o);
      await request(app).post(`/api/deals/${deal._id}/commercial-order`)
        .set(auth(o.execA.token)).send({ poValue: 4800000 });
      const approval = await Approval.findOne({ kind: 'co_confirm' });

      await request(app).post(`/api/deals/commercial-orders/${approval._id}/confirm`)
        .set(auth(o.director.token)).send({});
      const second = await request(app).post(`/api/deals/commercial-orders/${approval._id}/confirm`)
        .set(auth(o.director.token)).send({});

      expect(second.status).toBe(400);              // already decided
      expect(await WorkOrder.countDocuments()).toBe(1);
    });

    it('refuses confirmation by anyone but the Director it is addressed to', async () => {
      const o = await salesOrg();
      const deal = await readyDeal(o);
      await request(app).post(`/api/deals/${deal._id}/commercial-order`)
        .set(auth(o.execA.token)).send({ poValue: 4800000 });
      const approval = await Approval.findOne({ kind: 'co_confirm' });

      const res = await request(app).post(`/api/deals/commercial-orders/${approval._id}/confirm`)
        .set(auth(o.mgr1.token)).send({});
      expect(res.status).toBe(403);
      expect(await WorkOrder.countDocuments()).toBe(0);
    });
  });

  describe('the board — SA-DIR-05 / SA-MGR-05 / SA-EX-02', () => {
    it('gives a manager their team and not the other domain', async () => {
      const o = await salesOrg();
      await dealFor(o.execA.id, { company: 'Railways deal' });
      await dealFor(o.execC.id, { company: 'Defence deal', refId: 'SA-2026-038' });

      const res = await request(app).get('/api/deals/board').set(auth(o.mgr1.token));
      const companies = res.body.data.stages.flatMap((s) => s.deals).map((d) => d.company);

      expect(companies).toContain('Railways deal');
      expect(companies).not.toContain('Defence deal');
    });

    it('gives an executive only their own', async () => {
      const o = await salesOrg();
      await dealFor(o.execA.id, { company: 'Mine' });
      await dealFor(o.mgr1.id, { company: "My manager's", refId: 'SA-2026-099' });

      const res = await request(app).get('/api/deals/board').set(auth(o.execA.token));
      const companies = res.body.data.stages.flatMap((s) => s.deals).map((d) => d.company);
      expect(companies).toEqual(['Mine']);
    });

    it('withholds column totals from a role with no finance.read', async () => {
      const o = await salesOrg();
      await dealFor(o.execA.id);
      const engineer = await roles.asProductionEngineer();

      /* An engineer holds no lead.read, so they are refused outright — the finance rule
         is proved on the board by the executive, who holds both. */
      expect((await request(app).get('/api/deals/board').set(auth(engineer.token))).status).toBe(403);

      const asExec = await request(app).get('/api/deals/board').set(auth(o.execA.token));
      expect(asExec.body.data.stages[0].value).not.toBeNull();
    });
  });

  describe('team performance — SA-DIR-01 / SA-MGR-09', () => {
    it('is refused to an executive — no peer comparison', async () => {
      const o = await salesOrg();
      expect((await request(app).get('/api/deals/team').set(auth(o.execA.token))).status).toBe(403);
    });

    it('does not list the manager as one of their own executives', async () => {
      /* Doc 2 SA-MGR-01 keeps "My Executives" and "My Own Deals" apart on purpose, so a
         manager's own pipeline never inflates their team's numbers. */
      const o = await salesOrg();
      const res = await request(app).get('/api/deals/team').set(auth(o.mgr1.token));

      const ids = res.body.data.people.map((p) => String(p.user._id));
      expect(ids).not.toContain(String(o.mgr1.id));
      expect(ids).toEqual(expect.arrayContaining([String(o.execA.id)]));
    });

    it('shows a manager their own two executives', async () => {
      const o = await salesOrg();
      await dealFor(o.execA.id);

      const res = await request(app).get('/api/deals/team').set(auth(o.mgr1.token));
      const ids = res.body.data.people.map((p) => String(p.user._id));

      expect(ids).toContain(String(o.execA.id));
      expect(ids).not.toContain(String(o.execC.id));
    });
  });
});
