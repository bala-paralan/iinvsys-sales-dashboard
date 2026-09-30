'use strict';

/**
 * Why a team that had just entered fifteen leads read as "Last activity: none" and
 * "15 At Risk" on the Sales Command dashboard.
 *
 * Three separate assumptions, each wrong in the same direction — that nothing had
 * happened unless somebody filled in the activity form, and linked it to a deal:
 *
 *   1. `atRisk` treated a MISSING `lastActivityAt` as infinitely stale, so a deal was
 *      in trouble the moment it was created.
 *   2. "Last activity" per person read only the Activity collection, so creating and
 *      advancing leads all morning showed as "never".
 *   3. An activity logged against the ACCOUNT (the Log Activity screen's own default,
 *      "General account activity — no deal") stamped nothing, so the account's deals
 *      still reported no contact.
 */

const request = require('supertest');
const app = require('../src/app');
const Lead = require('../src/models/Lead');
const Customer = require('../src/models/Customer');
const Activity = require('../src/models/Activity');
const activityService = require('../src/services/activityService');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const roles = require('./helpers/roles');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const DAY = 86400000;

async function dealFor(owner, extra = {}) {
  return Lead.create({
    name: 'Rajesh Kumar', phone: '9100000041', company: 'DMRC Delhi',
    source: 'referral', track: 'sales', stage: 'prospect', owner,
    refId: `SA-2026-${Math.floor(Math.random() * 9000) + 1000}`, value: 4800000, ...extra,
  });
}

describe('what counts as activity — SPENCO CRM dashboards', () => {
  beforeAll(connect);
  afterAll(disconnect);
  beforeEach(clearCollections);

  describe('At Risk', () => {
    it('a deal created today is NOT at risk, though it has no activity yet', async () => {
      const t = await roles.salesTeam();
      await dealFor(t.execA.id);

      const res = await request(app).get('/api/deals/team').set(auth(t.manager.token));
      expect(res.status).toBe(200);
      expect(res.body.data.summary.atRisk).toBe(0);
      expect(res.body.data.people.find((p) => String(p.user._id) === String(t.execA.id)).atRisk).toBe(0);
    });

    it('a deal nobody has touched for three weeks IS at risk', async () => {
      const t = await roles.salesTeam();
      const old = new Date(Date.now() - 30 * DAY);
      const deal = await dealFor(t.execA.id);
      await Lead.updateOne({ _id: deal._id },
        { $set: { createdAt: old, stageEnteredAt: old, lastActivityAt: null } }, { timestamps: false });

      const res = await request(app).get('/api/deals/team').set(auth(t.manager.token));
      expect(res.body.data.summary.atRisk).toBe(1);
      expect(res.body.data.people.find((p) => String(p.user._id) === String(t.execA.id)).atRisk).toBe(1);
    });

    it('an old deal called yesterday is not at risk — recent contact outranks age', async () => {
      const t = await roles.salesTeam();
      const old = new Date(Date.now() - 30 * DAY);
      const deal = await dealFor(t.execA.id);
      await Lead.updateOne({ _id: deal._id },
        { $set: { createdAt: old, stageEnteredAt: old, lastActivityAt: new Date(Date.now() - DAY) } },
        { timestamps: false });

      const res = await request(app).get('/api/deals/team').set(auth(t.manager.token));
      expect(res.body.data.summary.atRisk).toBe(0);
    });

    /* The tile and the table answer the same question and must not disagree. */
    it('the summary tile and the per-person rows count the same deals', async () => {
      const t = await roles.salesTeam();
      const old = new Date(Date.now() - 40 * DAY);
      for (const owner of [t.execA.id, t.execB.id]) {
        const d = await dealFor(owner);
        await Lead.updateOne({ _id: d._id },
          { $set: { createdAt: old, stageEnteredAt: old } }, { timestamps: false });
        await dealFor(owner);                                    // fresh — not at risk
      }
      const res = await request(app).get('/api/deals/team').set(auth(t.manager.token));
      const rowTotal = res.body.data.people.reduce((n, p) => n + p.atRisk, 0);
      expect(res.body.data.summary.atRisk).toBe(2);
      expect(rowTotal).toBe(2);
    });
  });

  describe('"Last activity" reflects work, not just the activity form', () => {
    it('creating a lead counts — it is attributable work on a record', async () => {
      const t = await roles.salesTeam();
      const res = await request(app).post('/api/deals').set(auth(t.manager.token)).send({
        name: 'New Co', phone: '9100000055', company: 'New Co', source: 'referral',
        assignTo: t.execA.id, stage: 'suspect',
      });
      expect(res.status).toBe(201);

      /* The opening stageHistory entry names whoever raised it — here the manager. */
      const [creator] = await activityService.lastActivityFor([t.manager.id]);
      expect(creator.lastAt).not.toBeNull();
      expect(creator.severity).toBe('ok');

      /* The assignee has not done anything to it yet, and is not credited for it. */
      const [assignee] = await activityService.lastActivityFor([t.execA.id]);
      expect(assignee.lastAt).toBeNull();
    });

    it('a logged activity still wins when it is the more recent of the two', async () => {
      const t = await roles.salesTeam();
      const deal = await dealFor(t.execA.id);
      await Lead.updateOne({ _id: deal._id },
        { $set: { 'stageHistory.0.by': t.execA.id, 'stageHistory.0.at': new Date(Date.now() - 5 * DAY) } });
      await Activity.create({ customer: (await Customer.create({
        name: 'DMRC', normalizedKey: 'dmrc|delhi', city: 'Delhi',
      }))._id, type: 'call', summary: 'today', by: t.execA.id, occurredAt: new Date() });

      const [row] = await activityService.lastActivityFor([t.execA.id]);
      expect(row.hoursSince).toBeLessThan(1);
    });

    it('someone who has genuinely done nothing still reports never', async () => {
      const t = await roles.salesTeam();
      const [row] = await activityService.lastActivityFor([t.execB.id]);
      expect(row.lastAt).toBeNull();
      expect(row.severity).toBe('alert');
    });
  });

  describe('account-level activity reaches the account\'s deals', () => {
    it('logging with no deal stamps every open deal for that customer', async () => {
      const t = await roles.salesTeam();
      const cust = await Customer.create({ name: 'DMRC Delhi', normalizedKey: 'dmrc delhi|delhi', city: 'Delhi' });
      const openA = await dealFor(t.execA.id, { customer: cust._id });
      const openB = await dealFor(t.execA.id, { customer: cust._id, stage: 'engagement' });
      const won   = await dealFor(t.execA.id, { customer: cust._id, stage: 'commercial_order' });
      const other = await dealFor(t.execA.id);                    // different account

      const res = await request(app).post('/api/activities').set(auth(t.execA.token))
        .send({ customer: cust._id, type: 'call', summary: 'Spoke to the plant head' });
      expect(res.status).toBe(201);

      expect((await Lead.findById(openA).lean()).lastActivityAt).not.toBeNull();
      expect((await Lead.findById(openB).lean()).lastActivityAt).not.toBeNull();
      /* A closed deal's history is finished; reopening its clock would be a lie. */
      expect((await Lead.findById(won).lean()).lastActivityAt).toBeNull();
      expect((await Lead.findById(other).lean()).lastActivityAt).toBeNull();
    });

    it('logging against one deal still stamps only that deal', async () => {
      const t = await roles.salesTeam();
      const cust = await Customer.create({ name: 'ICF', normalizedKey: 'icf|chennai', city: 'Chennai' });
      const target = await dealFor(t.execA.id, { customer: cust._id });
      const sibling = await dealFor(t.execA.id, { customer: cust._id });

      await request(app).post('/api/activities').set(auth(t.execA.token))
        .send({ customer: cust._id, deal: target._id, type: 'visit', summary: 'Site visit' });

      expect((await Lead.findById(target).lean()).lastActivityAt).not.toBeNull();
      expect((await Lead.findById(sibling).lean()).lastActivityAt).toBeNull();
    });

    it('and that contact clears the deal from At Risk', async () => {
      const t = await roles.salesTeam();
      const cust = await Customer.create({ name: 'BHEL', normalizedKey: 'bhel|trichy', city: 'Trichy' });
      const old = new Date(Date.now() - 40 * DAY);
      const deal = await dealFor(t.execA.id, { customer: cust._id });
      await Lead.updateOne({ _id: deal._id },
        { $set: { createdAt: old, stageEnteredAt: old } }, { timestamps: false });

      const before = await request(app).get('/api/deals/team').set(auth(t.manager.token));
      expect(before.body.data.summary.atRisk).toBe(1);

      await request(app).post('/api/activities').set(auth(t.execA.token))
        .send({ customer: cust._id, type: 'call', summary: 'Checked in' });

      const after = await request(app).get('/api/deals/team').set(auth(t.manager.token));
      expect(after.body.data.summary.atRisk).toBe(0);
    });
  });
});
