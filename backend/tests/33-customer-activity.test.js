'use strict';
/**
 * Customers, the per-customer activity log, tasks and coaching notes.
 *
 * The rule under test is the one ERP Bible V3 restates in both doc 1 (IS-EX-03 note 1)
 * and doc 2 (SA-EX-04 note 1): activities belong to the COMPANY, not the lead. An
 * executive with three deals at DMRC sees one DMRC timeline.
 */
const request = require('supertest');
const app = require('../src/app');
const Customer = require('../src/models/Customer');
const Activity = require('../src/models/Activity');
const Task = require('../src/models/Task');
const Lead = require('../src/models/Lead');
const customerService = require('../src/services/customerService');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const roles = require('./helpers/roles');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('customers', () => {
  beforeAll(connect);
  afterAll(disconnect);
  beforeEach(clearCollections);

  describe('deduplication', () => {
    it('normalises away legal suffixes and punctuation', () => {
      const a = customerService.normalizeKey('BEL Sensors Pvt. Ltd.', 'Bangalore');
      const b = customerService.normalizeKey('BEL  Sensors', 'bangalore');
      expect(a).toBe(b);
    });

    it('keeps two sites of the same company apart', () => {
      /* "BEL Sensors, Bangalore" and "BEL Sensors, Chennai" are different accounts with
         different owners. The city is part of the key precisely so they do not merge. */
      expect(customerService.normalizeKey('BEL Sensors', 'Bangalore'))
        .not.toBe(customerService.normalizeKey('BEL Sensors', 'Chennai'));
    });

    it('returns near-matches to a human instead of linking them', async () => {
      const exec = await roles.asSalesExecutive();
      await Customer.create({ name: 'Ashok Leyland', normalizedKey: 'ashok leyland|pune', city: 'Pune' });

      const res = await request(app).post('/api/customers')
        /* Not "Ashok Leyland Ltd" — normalizeKey strips the legal suffix, so that pair
           matches exactly and never reaches the fuzzy pass at all. A misspelling is what
           actually needs a human. */
        .set(auth(exec.token)).send({ name: 'Ashok Layland', city: 'Pune' });

      expect(res.status).toBe(409);
      expect(res.body.candidates[0].name).toBe('Ashok Leyland');
      expect(await Customer.countDocuments()).toBe(1);
    });

    it('adopts the existing account when only the legal suffix differs', async () => {
      const exec = await roles.asSalesExecutive();
      await Customer.create({ name: 'Ashok Leyland', normalizedKey: 'ashok leyland|pune', city: 'Pune' });

      const res = await request(app).post('/api/customers')
        .set(auth(exec.token)).send({ name: 'Ashok Leyland Pvt. Ltd.', city: 'Pune' });

      /* 200, not 409: the normaliser reconciles these, so there is nothing to ask about. */
      expect(res.status).toBe(200);
      expect(await Customer.countDocuments()).toBe(1);
    });

    it('creates anyway when the person overrules it', async () => {
      const exec = await roles.asSalesExecutive();
      await Customer.create({ name: 'Ashok Leyland', normalizedKey: 'ashok leyland|pune', city: 'Pune' });

      const res = await request(app).post('/api/customers')
        .set(auth(exec.token)).send({ name: 'Ashok Leyland Foundries', city: 'Pune', confirmedNew: true });

      expect(res.status).toBe(201);
      expect(await Customer.countDocuments()).toBe(2);
    });

    it('never fuzzy-links on the automated path', async () => {
      await Customer.create({ name: 'ICF Chennai', normalizedKey: 'icf chennai|chennai', city: 'Chennai' });
      /* A handoff or a nightly job has no one to ask. An exact key match adopts the
         existing record; anything less creates a new one, because a wrong auto-merge
         under a unique index cannot be picked apart afterwards. */
      const { customer, created } = await customerService.findOrCreateCustomer(
        { name: 'Integral Coach Factory', city: 'Chennai' }, { interactive: false },
      );
      expect(created).toBe(true);
      expect(customer.name).toBe('Integral Coach Factory');
    });

    it('adopts the winner when two concurrent creates race', async () => {
      const [a, b] = await Promise.all([
        customerService.findOrCreateCustomer({ name: 'DMRC Delhi', city: 'Delhi' }, {}),
        customerService.findOrCreateCustomer({ name: 'DMRC Delhi', city: 'Delhi' }, {}),
      ]);
      expect(String(a.customer._id)).toBe(String(b.customer._id));
      expect(await Customer.countDocuments()).toBe(1);
    });
  });

  describe('merge', () => {
    it('moves the leads and the whole timeline onto the survivor', async () => {
      const director = await roles.asDirector();
      const loser  = await Customer.create({ name: 'ICF', normalizedKey: 'icf|chennai', city: 'Chennai' });
      const winner = await Customer.create({ name: 'ICF Chennai', normalizedKey: 'icf chennai|chennai', city: 'Chennai' });

      await Lead.create({ name: 'K.S.', phone: '9100000001', source: 'referral',
        customer: loser._id, owner: director.id });
      await Activity.create({ customer: loser._id, type: 'call', summary: 'intro', by: director.id });

      const res = await request(app).post(`/api/customers/${loser._id}/merge`)
        .set(auth(director.token)).send({ into: winner._id });

      expect(res.status).toBe(200);
      expect(await Lead.countDocuments({ customer: winner._id })).toBe(1);
      expect(await Activity.countDocuments({ customer: winner._id })).toBe(1);
      expect((await Customer.findById(loser._id)).mergedInto).toEqual(winner._id);
      expect((await Customer.findById(winner._id)).aliases).toContain('ICF');
    });
  });

  describe('customer 360', () => {
    it('shows every deal and every rep on one timeline', async () => {
      const director = await roles.asDirector();
      const execA = await roles.asSalesExecutive();
      const execB = await roles.asSalesExecutive();
      const cust = await Customer.create({ name: 'DMRC Delhi', normalizedKey: 'dmrc delhi|delhi', city: 'Delhi' });

      const deal1 = await Lead.create({ name: 'A', phone: '9100000001', source: 'referral',
        customer: cust._id, owner: execA.id, stage: 'commercial_order', value: 1000 });
      await Lead.create({ name: 'B', phone: '9100000002', source: 'referral',
        customer: cust._id, owner: execB.id, stage: 'engagement', value: 500 });

      await Activity.create({ customer: cust._id, deal: deal1._id, type: 'call', summary: 'from exec A', by: execA.id });
      await Activity.create({ customer: cust._id, type: 'email', summary: 'from exec B, no deal', by: execB.id });

      const res = await request(app).get(`/api/customers/${cust._id}/360`).set(auth(director.token));

      expect(res.status).toBe(200);
      expect(res.body.data.leads).toHaveLength(2);
      /* Two reps, two deals, and one activity with no deal at all — all one timeline. */
      expect(res.body.data.timeline).toHaveLength(2);
      expect(res.body.data.metrics.totalInteractions).toBe(2);
      expect(res.body.data.metrics.lifetimeRevenue).toBe(1000);
      expect(res.body.data.metrics.activeDeals).toBe(1);
    });
  });
});

describe('activities and tasks', () => {
  beforeAll(connect);
  afterAll(disconnect);
  beforeEach(clearCollections);

  async function fixture() {
    const team = await roles.salesTeam();
    const cust = await Customer.create({ name: 'DMRC Delhi', normalizedKey: 'dmrc delhi|delhi', city: 'Delhi' });
    return { ...team, cust };
  }

  it('auto-creates a task from the next action', async () => {
    const { execA, cust } = await fixture();

    const res = await request(app).post('/api/activities').set(auth(execA.token)).send({
      customer: cust._id, type: 'call', summary: 'Discovery — 22 min', durationMinutes: 22,
      nextAction: { label: 'Follow-up call in 3 days', dueAt: new Date(Date.now() + 3 * 86400000) },
    });

    expect(res.status).toBe(201);
    expect(res.body.data.task).not.toBeNull();
    expect(res.body.data.task.title).toBe('Follow-up call in 3 days');
    expect(res.body.data.task.source).toBe('activity_next_action');
    /* Linked both ways, so the timeline can show what the call led to. */
    expect(String(res.body.data.activity.createdTask)).toBe(String(res.body.data.task._id));
  });

  it('creates no task when no next action was chosen', async () => {
    const { execA, cust } = await fixture();
    await request(app).post('/api/activities').set(auth(execA.token))
      .send({ customer: cust._id, type: 'note', summary: 'FYI' });
    expect(await Task.countDocuments()).toBe(0);
  });

  it('stamps the deal so the weekly-note hygiene rule sees the activity', async () => {
    const { execA, cust } = await fixture();
    const deal = await Lead.create({ name: 'D', phone: '9100000001', source: 'referral',
      customer: cust._id, owner: execA.id, stage: 'engagement' });

    await request(app).post('/api/activities').set(auth(execA.token))
      .send({ customer: cust._id, deal: deal._id, type: 'call', summary: 'Weekly check-in' });

    /* config/pipeline.js is a pure function over one lead document and cannot query the
       Activity collection, so a deal with daily calls logged against it would otherwise
       still report stale notes. */
    const after = await Lead.findById(deal._id).lean();
    expect(after.lastActivityAt).not.toBeNull();
  });

  it('refuses an activity against a customer that does not exist', async () => {
    const { execA } = await fixture();
    const res = await request(app).post('/api/activities').set(auth(execA.token))
      .send({ customer: '507f1f77bcf86cd799439011', type: 'call', summary: 'x' });
    expect(res.status).toBe(400);
  });

  describe('who may read whose log', () => {
    it('pins an executive to their own entries even with ?by=', async () => {
      const { execA, execB, cust } = await fixture();
      await Activity.create({ customer: cust._id, type: 'call', summary: 'mine', by: execA.id });
      await Activity.create({ customer: cust._id, type: 'call', summary: 'my peer\'s', by: execB.id });

      const res = await request(app).get(`/api/activities?by=${execB.id}`).set(auth(execA.token));
      expect(res.body.data.map((a) => a.summary)).toEqual(['mine']);
    });

    it('lets a manager read their executive\'s log — SA-MGR-03', async () => {
      const { manager, execA, cust } = await fixture();
      await Activity.create({ customer: cust._id, type: 'call', summary: 'exec A call', by: execA.id });

      const res = await request(app).get(`/api/activities?by=${execA.id}`).set(auth(manager.token));
      expect(res.body.data.map((a) => a.summary)).toEqual(['exec A call']);
    });

    it('refuses a manager another team\'s executive', async () => {
      const railways = await roles.salesTeam('railways');
      const defence = await roles.salesTeam('defence');
      const res = await request(app).get(`/api/activities?by=${defence.execA.id}`)
        .set(auth(railways.manager.token));
      expect(res.status).toBe(403);
    });
  });

  describe('activity compliance — IS-DIR-01', () => {
    it('reports last-activity age with the doc 1 severity bands', async () => {
      const { manager, execA, execB, cust } = await fixture();
      await Activity.create({ customer: cust._id, type: 'call', summary: 'now', by: execA.id,
        occurredAt: new Date() });
      await Activity.create({ customer: cust._id, type: 'call', summary: 'old', by: execB.id,
        occurredAt: new Date(Date.now() - 50 * 3600000) });

      const res = await request(app).get('/api/activities/compliance').set(auth(manager.token));
      expect(res.status).toBe(200);
      expect(res.body.data.dailyTarget).toBe(5);

      const byId = Object.fromEntries(res.body.data.users.map((u) => [String(u.user), u]));
      expect(byId[String(execA.id)].severity).toBe('ok');
      expect(byId[String(execB.id)].severity).toBe('alert');    // 48h+ → red
      /* A manager who has logged nothing at all is the case IS-DIR-01 is really for. */
      expect(byId[String(manager.id)].severity).toBe('alert');
      expect(byId[String(manager.id)].lastAt).toBeNull();
    });
  });
});

describe('coaching notes — IS-DIR-02 / SA-MGR-03', () => {
  beforeAll(connect);
  afterAll(disconnect);
  beforeEach(clearCollections);

  it('lets a manager write and read a note about their executive', async () => {
    const { manager, execA } = await roles.salesTeam();
    const post = await request(app).post('/api/coaching-notes').set(auth(manager.token))
      .send({ about: execA.id, body: 'Discovery questions too surface-level.' });
    expect(post.status).toBe(201);

    const res = await request(app).get(`/api/coaching-notes?about=${execA.id}`).set(auth(manager.token));
    expect(res.body.data).toHaveLength(1);
  });

  it('never shows the subject a note about themselves', async () => {
    const { manager, execA } = await roles.salesTeam();
    await request(app).post('/api/coaching-notes').set(auth(manager.token))
      .send({ about: execA.id, body: 'Private assessment.' });

    /* The executive holds no coaching.read at all, so this is 403 — and even a role that
       did hold it gets an empty list for themselves rather than a 403, because telling
       someone a private note about them exists is most of the leak. */
    const res = await request(app).get(`/api/coaching-notes?about=${execA.id}`).set(auth(execA.token));
    expect(res.status).toBe(403);
  });

  it('shows a Director the note their manager wrote — visible UP the chain', async () => {
    const director = await roles.asDirector();
    const manager = await roles.asSalesManager({ reportsTo: director.id });
    const exec = await roles.asSalesExecutive({ reportsTo: manager.id });

    await request(app).post('/api/coaching-notes').set(auth(manager.token))
      .send({ about: exec.id, body: 'Needs shadowing.' });

    const res = await request(app).get(`/api/coaching-notes?about=${exec.id}`).set(auth(director.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('hides a Director\'s note from the manager beneath them', async () => {
    const director = await roles.asDirector();
    const manager = await roles.asSalesManager({ reportsTo: director.id });
    const exec = await roles.asSalesExecutive({ reportsTo: manager.id });

    await request(app).post('/api/coaching-notes').set(auth(director.token))
      .send({ about: exec.id, body: 'Director-only assessment.' });

    /* "Private — not visible to Rajan or IS Head": the subject's own manager is not an
       ancestor of the DIRECTOR who wrote it, so they must not see it. */
    const res = await request(app).get(`/api/coaching-notes?about=${exec.id}`).set(auth(manager.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('refuses a note about someone outside your team', async () => {
    const railways = await roles.salesTeam('railways');
    const defence = await roles.salesTeam('defence');
    const res = await request(app).post('/api/coaching-notes').set(auth(railways.manager.token))
      .send({ about: defence.execA.id, body: 'nope' });
    expect(res.status).toBe(403);
  });
});
