'use strict';
/**
 * Installation & Customer Support — ERP Bible V3, document 4.
 *
 * Doc 4 IC-AG-01 lists four things a CS Agent must not see, and each is refused by a
 * different mechanism. All four are asserted here, separately, because a single test that
 * "an agent sees less" would pass even if three of the four had quietly stopped working:
 *
 *   other agents' tickets   attachScope
 *   SLA comparisons         kpi.read_team
 *   team statistics         kpi.read_team
 *   AMC contract values     config/fieldVisibility.js at the response chokepoint
 *
 * And the loop that closes the whole specification: an expiring AMC becomes a
 * Suspect-stage deal for the executive who closed the original.
 */
const request = require('supertest');
const app = require('../src/app');
const mongoose = require('mongoose');
const Ticket = require('../src/models/Ticket');
const Contract = require('../src/models/Contract');
const Customer = require('../src/models/Customer');
const Lead = require('../src/models/Lead');
const InstallationJob = require('../src/models/InstallationJob');
const Approval = require('../src/models/Approval');
const pipeline = require('../src/config/pipeline');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const roles = require('./helpers/roles');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function supportOrg() {
  const installHead = await roles.asInstallHead();
  const kumar = await roles.asFieldEngineer({ reportsTo: installHead.id });
  const senthil = await roles.asFieldEngineer({ reportsTo: installHead.id });
  const csManager = await roles.asCSManager();
  const priya = await roles.asCSAgent({ reportsTo: csManager.id });
  const kiran = await roles.asCSAgent({ reportsTo: csManager.id });
  return { installHead, kumar, senthil, csManager, priya, kiran };
}

const customerFor = (name = 'DMRC Delhi') =>
  Customer.create({ name, normalizedKey: `${name.toLowerCase()}|delhi`, city: 'Delhi' });

let jobSeq = 0;
async function jobFor(technician, customer, extra = {}) {
  jobSeq += 1;
  return InstallationJob.create({
    jobNumber: `IJ-2026-${String(jobSeq).padStart(6, '0')}`,
    workOrder: new mongoose.Types.ObjectId(),
    customer: customer ? customer._id : null,
    customerSnapshot: { name: 'V. Anand', company: 'DMRC Delhi', city: 'Delhi' },
    technician,
    stage: 'post_support',
    ...extra,
  });
}

describe('Installation & Customer Support', () => {
  beforeAll(connect);
  afterAll(disconnect);
  beforeEach(clearCollections);

  describe('the SLA clock — doc 4 IC-AG-02', () => {
    it.each([['critical', 4], ['high', 8], ['medium', 24], ['low', 48]])(
      '%s tickets get a %ih target', (priority, hours) => {
        expect(pipeline.ticketSlaHours(priority)).toBe(hours);
      });

    it('stamps the due time from the priority at creation', async () => {
      const o = await supportOrg();
      const c = await customerFor();
      const res = await request(app).post('/api/tickets').set(auth(o.csManager.token))
        .send({ customer: c._id, subject: 'Sensor offline', priority: 'critical', assignedTo: o.priya.id });

      expect(res.status).toBe(201);
      expect(res.body.data.slaHours).toBe(4);
      const due = new Date(res.body.data.slaDueAt) - new Date(res.body.data.raisedAt);
      expect(Math.round(due / 3600000)).toBe(4);
    });

    it('re-derives the clock when a ticket is escalated', async () => {
      const o = await supportOrg();
      const c = await customerFor();
      const t = await Ticket.create({ ref: 'CS-2026-0001', customer: c._id, subject: 'x',
        priority: 'low', assignedTo: o.priya.id });
      expect(t.slaHours).toBe(48);

      await request(app).patch(`/api/tickets/${t._id}`).set(auth(o.priya.token))
        .send({ priority: 'critical' });

      const after = await Ticket.findById(t._id);
      /* An escalation that kept a 48-hour clock would be meaningless. */
      expect(after.slaHours).toBe(4);
    });

    it('records a breach and keeps it after resolution', async () => {
      const o = await supportOrg();
      const c = await customerFor();
      const t = await Ticket.create({
        ref: 'CS-2026-0002', customer: c._id, subject: 'late', priority: 'critical',
        assignedTo: o.priya.id, raisedAt: new Date(Date.now() - 10 * 3600000),
      });
      expect(t.slaBreached).toBe(true);

      await request(app).patch(`/api/tickets/${t._id}`).set(auth(o.priya.token))
        .send({ status: 'resolved', resolution: 'firmware pushed' });

      const after = await Ticket.findById(t._id);
      /* A breach that vanishes once someone fixes the ticket is a breach nobody reports. */
      expect(after.slaBreached).toBe(true);
      expect(after.resolvedAt).not.toBeNull();
    });

    it('refuses to resolve without saying how', async () => {
      const o = await supportOrg();
      const c = await customerFor();
      const t = await Ticket.create({ ref: 'CS-2026-0003', customer: c._id, subject: 'x',
        assignedTo: o.priya.id });

      const res = await request(app).patch(`/api/tickets/${t._id}`).set(auth(o.priya.token))
        .send({ status: 'resolved' });
      expect(res.status).toBe(400);
    });
  });

  describe('what a CS Agent must not see — doc 4 IC-AG-01, all four clauses', () => {
    it('1. another agent\'s tickets are absent from the list', async () => {
      const o = await supportOrg();
      const c = await customerFor();
      await Ticket.create({ ref: 'CS-1', customer: c._id, subject: 'Mine', assignedTo: o.priya.id });
      await Ticket.create({ ref: 'CS-2', customer: c._id, subject: 'Kirans', assignedTo: o.kiran.id });

      const res = await request(app).get('/api/tickets').set(auth(o.priya.token));
      expect(res.body.data.map((t) => t.subject)).toEqual(['Mine']);
    });

    it('1b. and answer 404 by id, so they cannot be probed', async () => {
      const o = await supportOrg();
      const c = await customerFor();
      const theirs = await Ticket.create({ ref: 'CS-3', customer: c._id, subject: 'x', assignedTo: o.kiran.id });

      expect((await request(app).get(`/api/tickets/${theirs._id}`)
        .set(auth(o.priya.token))).status).toBe(404);
    });

    it('2 & 3. SLA comparison and team statistics are refused outright', async () => {
      const o = await supportOrg();
      /* Not a filtered view — a leaderboard of one is still a leaderboard. */
      expect((await request(app).get('/api/tickets/sla').set(auth(o.priya.token))).status).toBe(403);
      expect((await request(app).get('/api/tickets/sla').set(auth(o.csManager.token))).status).toBe(200);
    });

    it('4. AMC values are stripped from the payload, but the rows are not', async () => {
      const o = await supportOrg();
      const c = await customerFor();
      await Contract.create({
        ref: 'AMC-2026-0001', customer: c._id, type: 'amc',
        startsAt: new Date(), expiresAt: new Date(Date.now() + 86400000 * 200),
        value: 1800000, renewalValue: 1800000,
      });

      const asAgent = await request(app).get('/api/contracts').set(auth(o.priya.token));
      expect(asAgent.status).toBe(200);
      expect(asAgent.body.data).toHaveLength(1);
      expect(asAgent.body.data[0].ref).toBe('AMC-2026-0001');
      /* The contract is visible; what it is worth is not. */
      expect(JSON.stringify(asAgent.body)).not.toMatch(/1800000/);
      expect(asAgent.body.data[0].value).toBeUndefined();

      const asManager = await request(app).get('/api/contracts').set(auth(o.csManager.token));
      expect(asManager.body.data[0].value).toBe(1800000);
    });

    it('an agent cannot reassign work between queues', async () => {
      const o = await supportOrg();
      const c = await customerFor();
      const t = await Ticket.create({ ref: 'CS-4', customer: c._id, subject: 'x', assignedTo: o.priya.id });

      expect((await request(app).post(`/api/tickets/${t._id}/assign`)
        .set(auth(o.priya.token)).send({ assignedTo: o.kiran.id })).status).toBe(403);
      expect((await request(app).post(`/api/tickets/${t._id}/assign`)
        .set(auth(o.csManager.token)).send({ assignedTo: o.kiran.id })).status).toBe(200);
    });

    it('an agent raising a ticket puts it on their OWN queue', async () => {
      const o = await supportOrg();
      const c = await customerFor();
      const res = await request(app).post('/api/tickets').set(auth(o.priya.token))
        .send({ customer: c._id, subject: 'x', assignedTo: o.kiran.id });

      expect(res.status).toBe(201);
      expect(String(res.body.data.assignedTo)).toBe(String(o.priya.id));
    });
  });

  describe('sign-off → AMC — doc 4 IC-FE-04 → IC-HD-04', () => {
    it('the engineer captures the signature and CSAT, and raises an approval', async () => {
      const o = await supportOrg();
      const c = await customerFor();
      const job = await jobFor(o.kumar.id, c);

      const res = await request(app).post(`/api/installations/${job._id}/sign-off`)
        .set(auth(o.kumar.token))
        .send({ signatoryName: 'Lt. Col. V. Sharma', signatoryTitle: 'PM', csat: 5,
                completionReport: '4 gateways commissioned, 3 operators trained' });

      expect(res.status).toBe(201);
      expect(res.body.data.kind).toBe('signoff');
      expect(String(res.body.data.assignedTo)).toBe(String(o.installHead.id));

      const after = await InstallationJob.findById(job._id);
      expect(after.signOff.csat).toBe(5);
      expect(after.signOff.signatoryName).toMatch(/Sharma/);
      /* Nothing downstream exists yet. */
      expect(await Contract.countDocuments()).toBe(0);
    });

    it('requires a named signatory and a real score', async () => {
      const o = await supportOrg();
      const job = await jobFor(o.kumar.id, await customerFor());

      expect((await request(app).post(`/api/installations/${job._id}/sign-off`)
        .set(auth(o.kumar.token)).send({ csat: 5 })).status).toBe(400);
      expect((await request(app).post(`/api/installations/${job._id}/sign-off`)
        .set(auth(o.kumar.token)).send({ signatoryName: 'X', csat: 0 })).status).toBe(400);
    });

    it('refuses a sign-off on another engineer\'s job', async () => {
      const o = await supportOrg();
      const job = await jobFor(o.senthil.id, await customerFor());

      expect((await request(app).post(`/api/installations/${job._id}/sign-off`)
        .set(auth(o.kumar.token)).send({ signatoryName: 'X', csat: 5 })).status).toBe(403);
    });

    it('the Head approving is what creates the AMC', async () => {
      const o = await supportOrg();
      const c = await customerFor();
      const job = await jobFor(o.kumar.id, c);
      await request(app).post(`/api/installations/${job._id}/sign-off`).set(auth(o.kumar.token))
        .send({ signatoryName: 'V. Sharma', csat: 5 });
      const approval = await Approval.findOne({ kind: 'signoff' });

      const res = await request(app).post(`/api/installations/sign-offs/${approval._id}/decide`)
        .set(auth(o.installHead.token)).send({ status: 'approved', value: 1800000 });

      expect(res.status).toBe(200);
      expect(res.body.data.contract.ref).toMatch(/^AMC-\d{4}-\d{4}$/);
      expect(await Contract.countDocuments()).toBe(1);

      const contract = await Contract.findOne();
      /* Doc 4: "1-year standard". */
      const months = Math.round((contract.expiresAt - contract.startsAt) / (86400000 * 30.44));
      expect(months).toBe(12);
      expect(String(contract.installationJob)).toBe(String(job._id));
    });

    it('is idempotent — a retried approval creates no second AMC', async () => {
      const o = await supportOrg();
      const job = await jobFor(o.kumar.id, await customerFor());
      await request(app).post(`/api/installations/${job._id}/sign-off`).set(auth(o.kumar.token))
        .send({ signatoryName: 'V. Sharma', csat: 5 });
      const approval = await Approval.findOne({ kind: 'signoff' });

      await request(app).post(`/api/installations/sign-offs/${approval._id}/decide`)
        .set(auth(o.installHead.token)).send({ status: 'approved' });
      const second = await request(app).post(`/api/installations/sign-offs/${approval._id}/decide`)
        .set(auth(o.installHead.token)).send({ status: 'approved' });

      expect(second.status).toBe(400);
      expect(await Contract.countDocuments()).toBe(1);
    });

    it('returning it sends the job back with no AMC', async () => {
      const o = await supportOrg();
      const job = await jobFor(o.kumar.id, await customerFor());
      await request(app).post(`/api/installations/${job._id}/sign-off`).set(auth(o.kumar.token))
        .send({ signatoryName: 'V. Sharma', csat: 2 });
      const approval = await Approval.findOne({ kind: 'signoff' });

      await request(app).post(`/api/installations/sign-offs/${approval._id}/decide`)
        .set(auth(o.installHead.token)).send({ status: 'returned', note: 'Photos missing' });

      const after = await InstallationJob.findById(job._id);
      expect(after.signOff.approval).toBeNull();
      expect(after.signOff.signedAt).toBeNull();
      expect(await Contract.countDocuments()).toBe(0);
    });

    it('a field engineer cannot approve their own sign-off', async () => {
      const o = await supportOrg();
      const job = await jobFor(o.kumar.id, await customerFor());
      await request(app).post(`/api/installations/${job._id}/sign-off`).set(auth(o.kumar.token))
        .send({ signatoryName: 'V. Sharma', csat: 5 });
      const approval = await Approval.findOne({ kind: 'signoff' });

      expect((await request(app).post(`/api/installations/sign-offs/${approval._id}/decide`)
        .set(auth(o.kumar.token)).send({ status: 'approved' })).status).toBe(403);
      expect(await Contract.countDocuments()).toBe(0);
    });
  });

  describe('the renewal loop — doc 4 IC-CSM-04, where the cycle closes', () => {
    async function expiringContract(o, opts = {}) {
      const c = await customerFor();
      const exec = await roles.asSalesExecutive();
      const origin = await Lead.create({
        name: 'A. Kumar', phone: '9100000001', source: 'referral', track: 'sales',
        refId: 'SA-2026-041', stage: 'commercial_order', owner: exec.id, customer: c._id,
      });
      const contract = await Contract.create({
        ref: 'AMC-2026-0009', customer: c._id, originDeal: origin._id, type: 'amc',
        product: 'ConnectSei RS Monitor',
        startsAt: new Date(Date.now() - 86400000 * 340),
        expiresAt: new Date(Date.now() + 86400000 * 20),
        value: 1800000, renewalValue: 1800000, ...opts,
      });
      return { contract, exec, customer: c };
    }

    it('lists contracts inside the 30-day window', async () => {
      const o = await supportOrg();
      await expiringContract(o);
      const res = await request(app).get('/api/contracts/renewals').set(auth(o.csManager.token));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].daysToExpiry).toBeLessThanOrEqual(30);
    });

    it('pushes to Sales as a Suspect for the exec who closed the original', async () => {
      const o = await supportOrg();
      const { contract, exec } = await expiringContract(o);

      const res = await request(app).post(`/api/contracts/${contract._id}/push-to-sales`)
        .set(auth(o.csManager.token)).send({});

      expect(res.status).toBe(200);
      const lead = res.body.data.lead;
      expect(lead.track).toBe('sales');
      expect(lead.stage).toBe('suspect');
      /* Doc 4: "the one who originally closed the deal" — not whoever owns the account. */
      expect(String(lead.owner)).toBe(String(exec.id));
      expect(lead.refId).toMatch(/^SA-\d{4}-\d{4}$/);
    });

    it('is idempotent — pushing twice yields one renewal deal', async () => {
      const o = await supportOrg();
      const { contract } = await expiringContract(o);

      await request(app).post(`/api/contracts/${contract._id}/push-to-sales`)
        .set(auth(o.csManager.token)).send({});
      const second = await request(app).post(`/api/contracts/${contract._id}/push-to-sales`)
        .set(auth(o.csManager.token)).send({});

      expect(second.status).toBe(200);
      expect(second.body.message).toMatch(/already/i);
      expect(await Lead.countDocuments({ stage: 'suspect', track: 'sales' })).toBe(1);
    });

    it('drops out of the renewals list once pushed', async () => {
      const o = await supportOrg();
      const { contract } = await expiringContract(o);
      await request(app).post(`/api/contracts/${contract._id}/push-to-sales`)
        .set(auth(o.csManager.token)).send({});

      const res = await request(app).get('/api/contracts/renewals').set(auth(o.csManager.token));
      expect(res.body.data).toHaveLength(0);
    });

    it('is refused to a CS Agent', async () => {
      const o = await supportOrg();
      const { contract } = await expiringContract(o);
      expect((await request(app).post(`/api/contracts/${contract._id}/push-to-sales`)
        .set(auth(o.priya.token)).send({})).status).toBe(403);
    });
  });

  describe('field engineers see only their own jobs — doc 4 IC-FE-01', () => {
    it('excludes another engineer\'s job', async () => {
      const o = await supportOrg();
      const c = await customerFor();
      await jobFor(o.kumar.id, c);
      await jobFor(o.senthil.id, c);

      const res = await request(app).get('/api/installations').set(auth(o.kumar.token));
      expect(res.body.data).toHaveLength(1);
    });

    it('gives the Install Head every job', async () => {
      const o = await supportOrg();
      const c = await customerFor();
      await jobFor(o.kumar.id, c);
      await jobFor(o.senthil.id, c);

      const res = await request(app).get('/api/installations').set(auth(o.installHead.token));
      expect(res.body.data).toHaveLength(2);
    });
  });
});
