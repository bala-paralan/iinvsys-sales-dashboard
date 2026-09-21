'use strict';

/**
 * SPENCO CRM brief §7 — Lead History Log, mandatory. Every lead must record and display:
 *   - who created it (name + timestamp)
 *   - who it was assigned to and when
 *   - every transfer — from whom, to whom, when
 *   - every status update — what changed and who changed it
 *
 * GET /api/leads/:id/history is the display; transferHistory + stageHistory are the
 * record. Asserted for both tracks, in order, with the actor named on each event.
 */

const request = require('supertest');
const app = require('../src/app');
const Lead = require('../src/models/Lead');
const Customer = require('../src/models/Customer');
const User = require('../src/models/User');
const pipeline = require('../src/config/pipeline');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const roles = require('./helpers/roles');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('lead history log — SPENCO CRM brief §7', () => {
  beforeAll(connect);
  afterAll(disconnect);
  beforeEach(clearCollections);

  it('opens with a created entry naming creator and first owner', async () => {
    const o = await roles.salesOrg();
    const res = await request(app).post('/api/deals').set(auth(o.northA.manager.token)).send({
      name: 'Rajesh Kumar', phone: '9100000041', company: 'DMRC Delhi', source: 'referral',
      assignTo: o.northA.execA.id, value: 1000000,
    });
    expect(res.status).toBe(201);
    const id = res.body.data.lead ? res.body.data.lead._id : res.body.data._id;

    const h = await request(app).get(`/api/leads/${id}/history`).set(auth(o.northA.manager.token));
    expect(h.status).toBe(200);
    expect(h.body.data.events[0]).toMatchObject({
      kind: 'created',
      actor: expect.objectContaining({ id: String(o.northA.manager.id) }),
      meta: expect.objectContaining({ to: expect.objectContaining({ id: String(o.northA.execA.id) }) }),
    });
    expect(h.body.data.events[0].summary).toMatch(/Created by .* assigned to/);
  });

  it('lists created → transferred → transferred → stage, in order, each with who and when', async () => {
    const o = await roles.salesOrg();
    const deal = await Lead.create({
      name: 'Rajesh Kumar', phone: '9100000041', company: 'DMRC Delhi',
      source: 'referral', track: 'sales', refId: 'SA-2026-041',
      stage: 'suspect', owner: o.northA.execA.id, createdBy: o.northA.manager.id, value: 4800000,
    });

    await request(app).post(`/api/leads/${deal._id}/transfer`)
      .set(auth(o.northA.manager.token)).send({ to: o.northA.execB.id, note: 'Realignment' });
    await request(app).post(`/api/leads/${deal._id}/transfer`)
      .set(auth(o.director.token)).send({ to: o.southA.execA.id });

    /* A real stage move, through the sanctioned door, so `by` is stamped by stageService. */
    const spenco = {};
    for (const d of pipeline.SPENCO_DIMENSIONS) spenco[d.key] = 3;
    const inAWeek = new Date(Date.now() + 7 * 86400000);
    await Lead.updateOne({ _id: deal._id }, { $set: {
      spenco, lastActivityAt: new Date(),
      jobTitle: 'GM Procurement', companyType: 'large_factory', city: 'Delhi', state: 'Delhi',
      industrySegment: 'railways', email: 'rajesh@dmrc.in',
      nextAction: 'Discovery call with GM', nextFollowUpDate: inAWeek,
    } });
    const adv = await request(app).post(`/api/leads/${deal._id}/advance`)
      .set(auth(o.southA.execA.token)).send({ toStage: 'prospect' });
    expect(adv.status).toBe(200);

    const h = await request(app).get(`/api/leads/${deal._id}/history`).set(auth(o.director.token));
    expect(h.status).toBe(200);
    const ev = h.body.data.events;
    expect(ev.map((e) => e.kind)).toEqual(['created', 'transferred', 'transferred', 'stage']);

    const [created, t1, t2, stage] = ev;
    expect(created.actor.id).toBe(String(o.northA.manager.id));
    expect(created.meta.to.id).toBe(String(o.northA.execA.id));

    expect(t1.meta.from.id).toBe(String(o.northA.execA.id));
    expect(t1.meta.to.id).toBe(String(o.northA.execB.id));
    expect(t1.actor.id).toBe(String(o.northA.manager.id));
    expect(t1.meta.note).toBe('Realignment');

    expect(t2.meta.from.id).toBe(String(o.northA.execB.id));
    expect(t2.meta.to.id).toBe(String(o.southA.execA.id));
    expect(t2.actor.id).toBe(String(o.director.id));

    expect(stage.meta).toMatchObject({ from: 'suspect', to: 'prospect' });
    expect(stage.actor.id).toBe(String(o.southA.execA.id));
    expect(stage.summary).toMatch(/Suspect → Prospect/);

    for (let i = 1; i < ev.length; i += 1) {
      expect(new Date(ev[i].at) >= new Date(ev[i - 1].at)).toBe(true);
    }
  });

  it('follows an Inside Sales lead across the hand-over, on both records', async () => {
    const o = await roles.salesOrg();
    const customer = await Customer.create({ name: 'Ashok Leyland', normalizedKey: 'ashok leyland|pune' });
    const lead = await Lead.create({
      name: 'Meena S', phone: '9100000099', company: 'Ashok Leyland', customer: customer._id,
      source: 'inside_sales_outbound', track: 'inside_sales', isStage: 'is_qualified',
      refId: 'IS-2026-007', owner: o.ise.id, createdBy: o.ism.id,
    });
    const res = await request(app).post(`/api/leads/${lead._id}/transfer`)
      .set(auth(o.ism.token)).send({ to: o.north.id, note: 'Zone account' });
    expect(res.status).toBe(200);

    const origin = await request(app).get(`/api/leads/${lead._id}/history`).set(auth(o.ism.token));
    expect(origin.body.data.events.map((e) => e.kind)).toEqual(['created', 'transferred']);
    expect(origin.body.data.events[1].meta.to.id).toBe(String(o.north.id));

    const deal = await request(app).get(`/api/leads/${res.body.data.salesLead._id}/history`).set(auth(o.north.token));
    const kinds = deal.body.data.events.map((e) => e.kind);
    expect(kinds[0]).toBe('created');
    /* The mint's audit row and the hand-over entry land in the same millisecond;
       their relative order is not a contract, their presence is. */
    expect(kinds.slice(1).sort()).toEqual(['handoff.created', 'transferred']);
    expect(deal.body.data.events.find((e) => e.kind === 'transferred').meta.note).toBe('Zone account');
  });

  it('keeps the names after the person is deleted', async () => {
    const o = await roles.salesOrg();
    const deal = await Lead.create({
      name: 'X', phone: '9100000001', source: 'referral', track: 'sales', refId: 'SA-2026-099',
      stage: 'suspect', owner: o.northA.execA.id, createdBy: o.northA.manager.id,
    });
    await request(app).post(`/api/leads/${deal._id}/transfer`)
      .set(auth(o.northA.manager.token)).send({ to: o.northA.execB.id });
    await User.findByIdAndDelete(o.northA.execA.id);

    const h = await request(app).get(`/api/leads/${deal._id}/history`).set(auth(o.director.token));
    const t = h.body.data.events.find((e) => e.kind === 'transferred');
    expect(t.meta.from.id).toBe(String(o.northA.execA.id));
    expect(t.meta.from.name).not.toBe('Former user');   // denormalised name survived
    expect(t.summary).toMatch(/Transferred from \S/);
  });

  it('is scope-checked like the lead itself', async () => {
    const o = await roles.salesOrg();
    const deal = await Lead.create({
      name: 'X', phone: '9100000001', source: 'referral', track: 'sales', refId: 'SA-2026-098',
      stage: 'suspect', owner: o.northA.execA.id,
    });
    expect((await request(app).get(`/api/leads/${deal._id}/history`).set(auth(o.northA.execA.token))).status).toBe(200);
    expect((await request(app).get(`/api/leads/${deal._id}/history`).set(auth(o.northA.execB.token))).status).toBe(403);
    expect((await request(app).get(`/api/leads/${deal._id}/history`).set(auth(o.southA.manager.token))).status).toBe(403);
    expect((await request(app).get(`/api/leads/${deal._id}/history`).set(auth(o.ise.token))).status).toBe(403);
  });
});
