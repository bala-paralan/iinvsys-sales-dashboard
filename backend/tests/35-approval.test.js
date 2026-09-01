'use strict';
/**
 * Approvals — one model, five queues.
 *
 * The behaviour that matters most here is that an approval is addressed to ONE PERSON.
 * notificationService.notifyByPermission fans out to every active holder of a permission,
 * which is right for "a work order needs accepting" and badly wrong for "Exec A wants 7%
 * off": that alerts all four Sales Managers and the whole director tier for a decision
 * only one of them can take, and a notification centre nobody trusts is worse than none.
 */
const request = require('supertest');
const app = require('../src/app');
const Approval = require('../src/models/Approval');
const Notification = require('../src/models/Notification');
const Lead = require('../src/models/Lead');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const roles = require('./helpers/roles');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('approvals', () => {
  beforeAll(connect);
  afterAll(disconnect);
  beforeEach(clearCollections);

  async function team() {
    const director = await roles.asDirector();
    const manager = await roles.asSalesManager({ domain: 'railways', reportsTo: director.id });
    const exec = await roles.asSalesExecutive({ domain: 'railways', reportsTo: manager.id });
    const lead = await Lead.create({ name: 'RVNL', phone: '9100000001', source: 'referral',
      stage: 'negotiation', owner: exec.id, value: 7800000 });
    return { director, manager, exec, lead };
  }

  it('routes a request to the requester\'s own manager, and to nobody else', async () => {
    const { director, manager, exec, lead } = await team();
    const otherManager = await roles.asSalesManager({ domain: 'defence', reportsTo: director.id });

    const res = await request(app).post('/api/approvals').set(auth(exec.token)).send({
      kind: 'discount', tier: 2,
      subject: { model: 'Lead', id: lead._id },
      payload: { percent: 7, justification: 'Competing quote at ₹72L' },
    });

    expect(res.status).toBe(201);
    expect(String(res.body.data.assignedTo)).toBe(String(manager.id));

    const notified = await Notification.find({ event: 'approval.requested' }).lean();
    expect(notified).toHaveLength(1);
    expect(String(notified[0].user)).toBe(String(manager.id));
    /* The regression: a role-broadcast would have reached these two as well. */
    expect(notified.map((n) => String(n.user))).not.toContain(String(otherManager.id));
    expect(notified.map((n) => String(n.user))).not.toContain(String(director.id));
  });

  it('refuses a request from someone with no one to report to', async () => {
    const orphan = await roles.asSalesExecutive();
    const lead = await Lead.create({ name: 'X', phone: '9100000002', source: 'referral', owner: orphan.id });

    const res = await request(app).post('/api/approvals').set(auth(orphan.token))
      .send({ kind: 'discount', subject: { model: 'Lead', id: lead._id } });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no one to report to/i);
  });

  it('shows the approver an inbox and the requester their own raised list', async () => {
    const { manager, exec, lead } = await team();
    await request(app).post('/api/approvals').set(auth(exec.token))
      .send({ kind: 'discount', subject: { model: 'Lead', id: lead._id } });

    const inbox = await request(app).get('/api/approvals').set(auth(manager.token));
    expect(inbox.body.data).toHaveLength(1);

    const raised = await request(app).get('/api/approvals?queue=raised').set(auth(exec.token));
    expect(raised.body.data).toHaveLength(1);

    /* The executive's inbox is empty — they raised it, they do not decide it. */
    const execInbox = await request(app).get('/api/approvals').set(auth(exec.token));
    expect(execInbox.body.data).toHaveLength(0);
  });

  it('lets only the assignee decide, even for another holder of approval.decide', async () => {
    const { director, manager, exec, lead } = await team();
    const otherManager = await roles.asSalesManager({ domain: 'defence', reportsTo: director.id });

    const created = await request(app).post('/api/approvals').set(auth(exec.token))
      .send({ kind: 'discount', subject: { model: 'Lead', id: lead._id } });
    const id = created.body.data._id;

    /* Holding `approval.decide` says you are the kind of person who approves things. It
       does not make someone else's queue yours. */
    const wrong = await request(app).post(`/api/approvals/${id}/decide`)
      .set(auth(otherManager.token)).send({ status: 'approved' });
    expect(wrong.status).toBe(403);

    const right = await request(app).post(`/api/approvals/${id}/decide`)
      .set(auth(manager.token)).send({ status: 'approved', decision: 'Approve 7%' });
    expect(right.status).toBe(200);
    expect((await Approval.findById(id)).status).toBe('approved');
  });

  it('tells the requester what was decided', async () => {
    const { manager, exec, lead } = await team();
    const created = await request(app).post('/api/approvals').set(auth(exec.token))
      .send({ kind: 'discount', subject: { model: 'Lead', id: lead._id } });

    await request(app).post(`/api/approvals/${created.body.data._id}/decide`)
      .set(auth(manager.token)).send({ status: 'returned', note: 'Prepare the impact sheet first' });

    const back = await Notification.find({ event: 'approval.decided' }).lean();
    expect(back).toHaveLength(1);
    expect(String(back[0].user)).toBe(String(exec.id));
    expect(back[0].body).toBe('Prepare the impact sheet first');
  });

  it('escalates one level up the chain — SA-MGR-08', async () => {
    const { director, manager, exec, lead } = await team();
    const created = await request(app).post('/api/approvals').set(auth(exec.token))
      .send({ kind: 'discount', tier: 3, subject: { model: 'Lead', id: lead._id } });

    const res = await request(app).post(`/api/approvals/${created.body.data._id}/escalate`)
      .set(auth(manager.token)).send({ note: '12% needs Director sign-off' });

    expect(res.status).toBe(200);
    const after = await Approval.findById(created.body.data._id);
    expect(after.status).toBe('escalated');
    expect(String(after.assignedTo)).toBe(String(director.id));

    const notified = await Notification.find({ event: 'approval.escalated' }).lean();
    expect(String(notified[0].user)).toBe(String(director.id));
    /* Escalated, not closed: the Director can now decide it. */
    const decided = await request(app).post(`/api/approvals/${created.body.data._id}/decide`)
      .set(auth(director.token)).send({ status: 'approved' });
    expect(decided.status).toBe(200);
  });

  it('refuses to decide the same approval twice', async () => {
    const { manager, exec, lead } = await team();
    const created = await request(app).post('/api/approvals').set(auth(exec.token))
      .send({ kind: 'discount', subject: { model: 'Lead', id: lead._id } });
    const id = created.body.data._id;

    await request(app).post(`/api/approvals/${id}/decide`).set(auth(manager.token)).send({ status: 'approved' });
    const again = await request(app).post(`/api/approvals/${id}/decide`)
      .set(auth(manager.token)).send({ status: 'rejected' });

    expect(again.status).toBe(400);
    expect((await Approval.findById(id)).status).toBe('approved');
  });

  it('hides an approval from anyone not party to it', async () => {
    const { director, manager, exec, lead } = await team();
    const stranger = await roles.asSalesManager({ domain: 'defence', reportsTo: director.id });
    const created = await request(app).post('/api/approvals').set(auth(exec.token))
      .send({ kind: 'discount', subject: { model: 'Lead', id: lead._id } });

    const res = await request(app).get(`/api/approvals/${created.body.data._id}`).set(auth(stranger.token));
    /* 404 rather than 403, so ids cannot be probed for existence. */
    expect(res.status).toBe(404);

    expect((await request(app).get(`/api/approvals/${created.body.data._id}`)
      .set(auth(manager.token))).status).toBe(200);
  });

  it('rejects an unknown decision status', async () => {
    const { manager, exec, lead } = await team();
    const created = await request(app).post('/api/approvals').set(auth(exec.token))
      .send({ kind: 'discount', subject: { model: 'Lead', id: lead._id } });

    const res = await request(app).post(`/api/approvals/${created.body.data._id}/decide`)
      .set(auth(manager.token)).send({ status: 'maybe' });
    expect(res.status).toBe(400);
  });
});
