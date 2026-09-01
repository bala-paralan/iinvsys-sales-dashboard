'use strict';
/**
 * Inside Sales — ERP Bible V3, document 1.
 *
 * The three things worth pinning here are the ones the specification is emphatic about
 * and that are easy to get subtly wrong:
 *
 *   1. An IS Executive sees ONLY their own leads; the IS Head sees their whole team.
 *   2. BANT must be complete before a handoff, and a confirmation needs a note — the
 *      IS Head reads those notes to decide, so a bare tick is not a qualification.
 *   3. A Sales deal is minted ONLY by an approved handoff (or the Director's explicit
 *      bypass). Nothing else may create one, or "no deal without qualification" is a
 *      convention rather than a property.
 */
const request = require('supertest');
const app = require('../src/app');
const Lead = require('../src/models/Lead');
const Customer = require('../src/models/Customer');
const Approval = require('../src/models/Approval');
const Activity = require('../src/models/Activity');
const Task = require('../src/models/Task');
const pipeline = require('../src/config/pipeline');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const roles = require('./helpers/roles');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function isTeam() {
  const director = await roles.asDirector();
  const head = await roles.asISHead({ reportsTo: director.id });
  const execA = await roles.asISExec({ reportsTo: head.id });
  const execB = await roles.asISExec({ reportsTo: head.id });
  const salesMgr = await roles.asSalesManager({ reportsTo: director.id, domain: 'railways' });
  const salesExec = await roles.asSalesExecutive({ reportsTo: salesMgr.id, domain: 'railways' });
  return { director, head, execA, execB, salesMgr, salesExec };
}

const CAPTURE = {
  name: 'K. Subramaniam', phone: '9100000001', company: 'ICF Chennai',
  city: 'Chennai', state: 'Tamil Nadu', source: 'inside_sales_outbound',
};

describe('Inside Sales', () => {
  beforeAll(connect);
  afterAll(disconnect);
  beforeEach(clearCollections);

  describe('capture and routing — IS-DIR-03', () => {
    it('assigns to an IS Executive and notifies them', async () => {
      const t = await isTeam();
      const res = await request(app).post('/api/is/leads').set(auth(t.head.token))
        .send({ ...CAPTURE, assignmentMode: 'is_executive', assignTo: t.execA.id });

      expect(res.status).toBe(201);
      expect(res.body.data.lead.track).toBe('inside_sales');
      expect(res.body.data.lead.isStage).toBe('is_new');
      expect(res.body.data.lead.refId).toMatch(/^IS-\d{4}-\d{4}$/);
      expect(String(res.body.data.lead.owner)).toBe(String(t.execA.id));
    });

    it('creates the customer account the activity log hangs off', async () => {
      const t = await isTeam();
      await request(app).post('/api/is/leads').set(auth(t.head.token))
        .send({ ...CAPTURE, assignmentMode: 'is_executive', assignTo: t.execA.id });

      const customer = await Customer.findOne({ name: 'ICF Chennai' });
      expect(customer).not.toBeNull();
      const lead = await Lead.findOne({ track: 'inside_sales' });
      expect(String(lead.customer)).toBe(String(customer._id));
    });

    it('holds a Director-managed lead rather than leaving it unassigned', async () => {
      const t = await isTeam();
      const res = await request(app).post('/api/is/leads').set(auth(t.director.token))
        .send({ ...CAPTURE, assignmentMode: 'director_managed' });

      expect(res.status).toBe(201);
      expect(res.body.data.lead.directorManaged).toBe(true);
      /* Held, not unassigned — IS-DIR-01 counts and chases those separately. */
      expect(String(res.body.data.lead.owner)).toBe(String(t.director.id));
    });

    it('Bypass IS creates BOTH records, so the origin stays visible', async () => {
      const t = await isTeam();
      const res = await request(app).post('/api/is/leads').set(auth(t.director.token))
        .send({ ...CAPTURE, assignmentMode: 'bypass_is', assignTo: t.salesExec.id });

      expect(res.status).toBe(201);
      const { lead, salesLead } = res.body.data;
      expect(lead.track).toBe('inside_sales');
      expect(salesLead.track).toBe('sales');
      expect(salesLead.refId).toMatch(/^SA-\d{4}-\d{4}$/);
      expect(salesLead.stage).toBe('prospect');
      expect(String(salesLead.owner)).toBe(String(t.salesExec.id));
      expect(String(salesLead.originLead)).toBe(String(lead._id));
    });

    it('refuses a bypass to someone who is not in Sales', async () => {
      const t = await isTeam();
      const res = await request(app).post('/api/is/leads').set(auth(t.director.token))
        .send({ ...CAPTURE, assignmentMode: 'bypass_is', assignTo: t.execA.id });
      expect(res.status).toBe(400);
    });
  });

  describe('visibility — doc 1\'s central rule', () => {
    it('an executive sees only their own leads', async () => {
      const t = await isTeam();
      await Lead.create({ ...CAPTURE, track: 'inside_sales', isStage: 'is_new', owner: t.execA.id, name: 'Mine' });
      await Lead.create({ ...CAPTURE, track: 'inside_sales', isStage: 'is_new', owner: t.execB.id, name: 'My peer\'s' });

      const res = await request(app).get('/api/is/leads').set(auth(t.execA.token));
      expect(res.body.data.map((l) => l.name)).toEqual(['Mine']);
    });

    it('the IS Head sees the whole team', async () => {
      const t = await isTeam();
      await Lead.create({ ...CAPTURE, track: 'inside_sales', isStage: 'is_new', owner: t.execA.id, name: 'A' });
      await Lead.create({ ...CAPTURE, track: 'inside_sales', isStage: 'is_new', owner: t.execB.id, name: 'B' });

      const res = await request(app).get('/api/is/leads').set(auth(t.head.token));
      expect(res.body.data.map((l) => l.name).sort()).toEqual(['A', 'B']);
    });

    it('lets an executive open their own lead', async () => {
      /* The negative case below passed while this one was broken: `getLead` populates
         `owner`, so the scope check compared a document against a set of ids, matched
         nothing, and 404'd the owner out of their own record. Asserting only the refusal
         is how a check that refuses EVERYONE looks correct. */
      const t = await isTeam();
      const mine = await Lead.create({ ...CAPTURE, track: 'inside_sales', isStage: 'is_new', owner: t.execA.id });
      const res = await request(app).get(`/api/is/leads/${mine._id}`).set(auth(t.execA.token));
      expect(res.status).toBe(200);
      expect(res.body.data.refId).toBe(mine.refId);
    });

    it('answers 404, not 403, for someone else\'s lead so ids cannot be probed', async () => {
      const t = await isTeam();
      const other = await Lead.create({ ...CAPTURE, track: 'inside_sales', isStage: 'is_new', owner: t.execB.id });
      const res = await request(app).get(`/api/is/leads/${other._id}`).set(auth(t.execA.token));
      expect(res.status).toBe(404);
    });

    it('keeps the IS Head out of the Sales pipeline entirely', async () => {
      const t = await isTeam();
      await Lead.create({ name: 'A deal', phone: '9100000009', source: 'referral',
        track: 'sales', stage: 'negotiation', owner: t.salesExec.id });

      const res = await request(app).get('/api/leads').set(auth(t.head.token));
      expect(res.status).toBe(200);
      /* Doc 1: "Cannot see Sales pipeline." Enforced by the scope resolver's track
         filter, not by withholding lead.read. */
      expect(res.body.data.map((l) => l.name)).not.toContain('A deal');
    });
  });

  describe('BANT — IS-EX-05', () => {
    async function leadFor(t) {
      const customer = await Customer.create({ name: 'BHEL Trichy', normalizedKey: 'bhel trichy|trichy' });
      return Lead.create({ ...CAPTURE, track: 'inside_sales', isStage: 'is_contacted',
        owner: t.execA.id, customer: customer._id, lastActivityAt: new Date() });
    }

    it('refuses a confirmation with no note', async () => {
      const t = await isTeam();
      const lead = await leadFor(t);
      const res = await request(app).patch(`/api/is/leads/${lead._id}/bant`)
        .set(auth(t.execA.token)).send({ budget: { confirmed: true } });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/before confirming budget/i);
    });

    it('records the note the IS Head later reads', async () => {
      const t = await isTeam();
      const lead = await leadFor(t);
      const res = await request(app).patch(`/api/is/leads/${lead._id}/bant`)
        .set(auth(t.execA.token))
        .send({ budget: { confirmed: true, note: '₹60–80L confirmed by the DGM' } });

      expect(res.status).toBe(200);
      expect(res.body.data.bant.budget.confirmed).toBe(true);
      expect(res.body.data.bant.budget.note).toMatch(/60–80L/);
      expect(res.body.data.complete).toBe(false);
    });

    it('reports complete only when all four are confirmed', async () => {
      const t = await isTeam();
      const lead = await leadFor(t);
      const body = {};
      for (const k of pipeline.BANT_KEYS) body[k] = { confirmed: true, note: `${k} established` };
      const res = await request(app).patch(`/api/is/leads/${lead._id}/bant`)
        .set(auth(t.execA.token)).send(body);
      expect(res.body.data.complete).toBe(true);
    });
  });

  describe('handoff — IS-EX-05 → IS-HD-04', () => {
    async function qualifiedLead(t) {
      const customer = await Customer.create({ name: 'Ashok Leyland', normalizedKey: 'ashok leyland|pune' });
      const bant = {};
      for (const k of pipeline.BANT_KEYS) {
        bant[k] = { confirmed: true, note: `${k} established`, confirmedAt: new Date(), confirmedBy: t.execA.id };
      }
      return Lead.create({ ...CAPTURE, track: 'inside_sales', isStage: 'is_qualified',
        owner: t.execA.id, customer: customer._id, lastActivityAt: new Date(), bant });
    }

    it('refuses a handoff while BANT is incomplete, and names what is missing', async () => {
      const t = await isTeam();
      const customer = await Customer.create({ name: 'X Ltd', normalizedKey: 'x|pune' });
      const lead = await Lead.create({ ...CAPTURE, track: 'inside_sales', isStage: 'is_contacted',
        owner: t.execA.id, customer: customer._id });

      const res = await request(app).post(`/api/is/leads/${lead._id}/request-handoff`)
        .set(auth(t.execA.token)).send({});

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('BANT_INCOMPLETE');
      expect(res.body.missing).toHaveLength(4);
    });

    it('raises a request addressed to the executive\'s own IS Head', async () => {
      const t = await isTeam();
      const lead = await qualifiedLead(t);
      const res = await request(app).post(`/api/is/leads/${lead._id}/request-handoff`)
        .set(auth(t.execA.token)).send({ note: 'Bosch is circling — 3-week window' });

      expect(res.status).toBe(201);
      expect(res.body.data.kind).toBe('is_handoff');
      /* Addressed to one person, not broadcast to everyone who can approve. */
      expect(String(res.body.data.assignedTo)).toBe(String(t.head.id));

      const after = await Lead.findById(lead._id);
      expect(after.isStage).toBe('is_handoff_requested');
    });

    it('mints the Sales deal ONLY when the Head approves', async () => {
      const t = await isTeam();
      const lead = await qualifiedLead(t);
      await request(app).post(`/api/is/leads/${lead._id}/request-handoff`)
        .set(auth(t.execA.token)).send({});
      const approval = await Approval.findOne({ kind: 'is_handoff' });

      expect(await Lead.countDocuments({ track: 'sales' })).toBe(0);

      const res = await request(app).post(`/api/is/handoffs/${approval._id}/decide`)
        .set(auth(t.head.token)).send({ status: 'approved', assignTo: t.salesExec.id });

      expect(res.status).toBe(200);
      expect(res.body.data.salesLead.track).toBe('sales');
      expect(res.body.data.salesLead.stage).toBe('prospect');

      const converted = await Lead.findById(lead._id);
      expect(converted.isStage).toBe('is_converted');
      expect(String(converted.convertedTo)).toBe(String(res.body.data.salesLead._id));
    });

    it('returning it sends the lead back to the executive, workable', async () => {
      const t = await isTeam();
      const lead = await qualifiedLead(t);
      await request(app).post(`/api/is/leads/${lead._id}/request-handoff`)
        .set(auth(t.execA.token)).send({});
      const approval = await Approval.findOne({ kind: 'is_handoff' });

      await request(app).post(`/api/is/handoffs/${approval._id}/decide`)
        .set(auth(t.head.token)).send({ status: 'returned', note: 'Get the DGM on record' });

      const after = await Lead.findById(lead._id);
      expect(after.isStage).toBe('is_qualified');
      expect(after.handoffApproval).toBeNull();
      expect(await Lead.countDocuments({ track: 'sales' })).toBe(0);
    });

    it('refuses a decision from someone the approval is not addressed to', async () => {
      const t = await isTeam();
      const lead = await qualifiedLead(t);
      await request(app).post(`/api/is/leads/${lead._id}/request-handoff`)
        .set(auth(t.execA.token)).send({});
      const approval = await Approval.findOne({ kind: 'is_handoff' });

      /* Holding approval.decide makes you the KIND of person who approves things; it
         does not make someone else's queue yours. */
      const other = await roles.asISHead();
      const res = await request(app).post(`/api/is/handoffs/${approval._id}/decide`)
        .set(auth(other.token)).send({ status: 'approved', assignTo: t.salesExec.id });
      expect(res.status).toBe(403);
    });

    it('is idempotent — a retried approval adopts the deal it already minted', async () => {
      const t = await isTeam();
      const lead = await qualifiedLead(t);
      await request(app).post(`/api/is/leads/${lead._id}/request-handoff`)
        .set(auth(t.execA.token)).send({});
      const approval = await Approval.findOne({ kind: 'is_handoff' });

      await request(app).post(`/api/is/handoffs/${approval._id}/decide`)
        .set(auth(t.head.token)).send({ status: 'approved', assignTo: t.salesExec.id });
      const second = await request(app).post(`/api/is/handoffs/${approval._id}/decide`)
        .set(auth(t.head.token)).send({ status: 'approved', assignTo: t.salesExec.id });

      expect(second.status).toBe(400);        // already decided
      expect(await Lead.countDocuments({ track: 'sales' })).toBe(1);
    });

    it('cannot be reached by moving the stage by hand', async () => {
      const t = await isTeam();
      const lead = await qualifiedLead(t);
      const res = await request(app).post(`/api/is/leads/${lead._id}/advance`)
        .set(auth(t.execA.token)).send({ toStage: 'is_converted' });

      expect(res.status).toBe(400);
      expect(await Lead.countDocuments({ track: 'sales' })).toBe(0);
    });
  });

  describe('activity seeds the next task — IS-EX-03 note 2', () => {
    it('creates a dated task from the next action, in one operation', async () => {
      const t = await isTeam();
      const customer = await Customer.create({ name: 'DMRC Delhi', normalizedKey: 'dmrc|delhi' });

      const res = await request(app).post('/api/activities').set(auth(t.execA.token)).send({
        customer: customer._id,
        type: 'call',
        durationMinutes: 18,
        summary: 'Discovery — evaluating IoT for LHB coaches',
        nextAction: { label: 'Send capability deck', dueAt: '2026-12-01' },
      });

      expect(res.status).toBe(201);
      expect(res.body.data.task.title).toBe('Send capability deck');
      expect(await Task.countDocuments({ owner: t.execA.id })).toBe(1);
      const activity = await Activity.findById(res.body.data.activity._id);
      expect(String(activity.createdTask)).toBe(String(res.body.data.task._id));
    });

    it('stamps the deal so the stale-notes rule sees the contact', async () => {
      const t = await isTeam();
      const customer = await Customer.create({ name: 'RVNL', normalizedKey: 'rvnl|mumbai' });
      const lead = await Lead.create({ ...CAPTURE, track: 'inside_sales', isStage: 'is_new',
        owner: t.execA.id, customer: customer._id });

      await request(app).post('/api/activities').set(auth(t.execA.token))
        .send({ customer: customer._id, deal: lead._id, type: 'email', summary: 'Deck sent' });

      const after = await Lead.findById(lead._id);
      expect(after.lastActivityAt).not.toBeNull();
    });
  });

  describe('team performance — IS-DIR-01 / IS-HD-01', () => {
    it('reports each executive, scoped to the caller\'s own team', async () => {
      const t = await isTeam();
      await Lead.create({ ...CAPTURE, track: 'inside_sales', isStage: 'is_qualified', owner: t.execA.id });
      await Lead.create({ ...CAPTURE, track: 'inside_sales', isStage: 'is_new', owner: t.execA.id });

      const res = await request(app).get('/api/is/team').set(auth(t.head.token));
      expect(res.status).toBe(200);

      const row = res.body.data.execs.find((e) => String(e.user._id) === String(t.execA.id));
      expect(row.assigned).toBe(2);
      expect(row.qualified).toBe(1);
      expect(row.qualificationRate).toBe(50);
    });

    it('is refused to an executive — no peer comparison', async () => {
      const t = await isTeam();
      const res = await request(app).get('/api/is/team').set(auth(t.execA.token));
      expect(res.status).toBe(403);
    });
  });
});
