'use strict';
/**
 * Installation & Customer Service — B3. (H-2, I-1…I-11, A13, A14)
 *
 * The properties this suite defends:
 *   · Handoff 2 is reachable only through the DA gate, and idempotent (H-2/H-3).
 *   · Commissioning needs BOTH signatures — the framework says "signed by the
 *     technician and countersigned by the customer representative", and one
 *     signature must not satisfy it (I-9).
 *   · A job cannot close without feedback, and cannot close on a low CSAT
 *     without a documented corrective action plan (I-7, I-8).
 */
const request = require('supertest');
const app = require('../src/app');
const Lead = require('../src/models/Lead');
const WorkOrder = require('../src/models/WorkOrder');
const InstallationJob = require('../src/models/InstallationJob');
const Notification = require('../src/models/Notification');
const handoff = require('../src/services/handoffService');
const sweeps = require('../src/utils/jobs/installationSweeps');
const pipeline = require('../src/config/pipeline');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

let imToken, techToken, techId, csToken, dmToken, managerId;

const daysAgo = (n) => new Date(Date.now() - n * 86400000);

/** A delivered Work Order — i.e. Handoff 2's trigger, legitimately reached. */
async function deliveredWorkOrder() {
  const lead = await Lead.create({
    name: 'Rajesh Kumar', phone: `98765${Math.floor(10000 + Math.random() * 89999)}`,
    source: 'exhibition_event', stage: 'commercial_order',
    company: 'Sharma Industries', state: 'Maharashtra', poNumber: 'PO-114', value: 250000,
  });
  const wo = await handoff.createWorkOrderForLead(lead);
  wo.attachments.push(
    { docType: 'delivery_acknowledgement', filename: 'da.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: 'k1' },
    { docType: 'da_photo', filename: 'p.png', mimeType: 'image/png', sizeBytes: 10, storageKey: 'k2' },
  );
  wo.deliveryAccuracy.itemsDelivered = 2;
  wo.status = 'delivered';
  wo.deliveredAt = new Date();
  await wo.save();
  return wo;
}

async function jobFromHandoff() {
  const wo = await deliveredWorkOrder();
  return handoff.createInstallationJobForWorkOrder(wo);
}

const as = (token) => ({
  post: (p, b) => request(app).post(`/api/installations${p}`).set('Authorization', `Bearer ${token}`).send(b),
  patch: (p, b) => request(app).patch(`/api/installations${p}`).set('Authorization', `Bearer ${token}`).send(b),
  get: (p) => request(app).get(`/api/installations${p}`).set('Authorization', `Bearer ${token}`),
});

/** Tick every required item on a stage checklist. */
async function completeChecklist(jobId, stageKey, token, sign) {
  const job = await InstallationJob.findById(jobId).lean();
  const cl = job.checklists.find((c) => c.stageKey === stageKey);
  for (const item of cl.items) {
    await as(token).patch(`/${jobId}/checklist`, { stageKey, itemKey: item.key, done: true });
  }
  if (sign) await as(token).patch(`/${jobId}/checklist`, { stageKey, signedByName: sign });
}

beforeAll(connect);
afterAll(disconnect);
beforeEach(async () => {
  await clearCollections();
  imToken = tok(await insertUser({ role: 'installation_manager', name: 'Ivan' }));
  techId = await insertUser({ role: 'technician', name: 'Tara' });
  techToken = tok(techId);
  csToken = tok(await insertUser({ role: 'cs_executive', name: 'Chandni' }));
  dmToken = tok(await insertUser({ role: 'delivery_manager', name: 'Dev' }));
  managerId = await insertUser({ role: 'manager', name: 'Sneha' });
});

describe('Handoff 2 — signed DA creates the Installation Job (H-2)', () => {
  it('creates the job with the customer snapshot carried through both handoffs', async () => {
    const job = await jobFromHandoff();

    expect(job.jobNumber).toMatch(/^IJ-\d{4}-\d{6}$/);
    expect(job.stage).toBe('planning');
    expect(job.status).toBe('open');
    /* Lead → Work Order → Installation Job, never re-read from the Lead (A24). */
    expect(job.customerSnapshot.company).toBe('Sharma Industries');
    expect(job.customerSnapshot.zone).toBe('west');
  });

  it('instantiates every stage checklist from the pipeline templates', async () => {
    const job = await jobFromHandoff();
    expect(job.checklists.map((c) => c.stageKey))
      .toEqual(['planning', 'on_site', 'commissioning', 'handover_training']);
    expect(job.checklists[0].items).toHaveLength(6);
    expect(job.checklists[0].items.every((i) => i.done === false)).toBe(true);
  });

  it('sets the back-pointer and notifies the Installation Manager', async () => {
    const job = await jobFromHandoff();
    const wo = await WorkOrder.findById(job.workOrder).lean();
    expect(String(wo.installationJob)).toBe(String(job._id));

    const n = await Notification.findOne({ event: 'handoff.installation_created' }).lean();
    expect(n).not.toBeNull();
    expect(n.severity).toBe('critical');
  });

  it('is idempotent — a retried delivery does not mint a second job', async () => {
    const wo = await deliveredWorkOrder();
    const first = await handoff.createInstallationJobForWorkOrder(wo);
    const second = await handoff.createInstallationJobForWorkOrder(await WorkOrder.findById(wo._id));

    expect(String(second._id)).toBe(String(first._id));
    expect(await InstallationJob.countDocuments()).toBe(1);
  });

  it('the repair pass creates for delivered orders that have no job', async () => {
    await deliveredWorkOrder();          // orphan
    const done = await deliveredWorkOrder();
    await handoff.createInstallationJobForWorkOrder(done);

    expect(await handoff.ensureInstallationJobExists()).toEqual({ orphaned: 1, repaired: 1 });
    expect(await InstallationJob.countDocuments()).toBe(2);
  });

  it('fires through the real deliver endpoint, end to end', async () => {
    const wo = await deliveredWorkOrder();
    wo.status = 'in_progress'; wo.deliveredAt = null; await wo.save();

    const res = await request(app).post(`/api/workorders/${wo._id}/deliver`)
      .set('Authorization', `Bearer ${dmToken}`).send({ itemsDelivered: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data.installationJob.jobNumber).toMatch(/^IJ-/);
  });
});

describe('permissions — doc 04, enforced', () => {
  it('a technician sees only their own jobs', async () => {
    const mine = await jobFromHandoff();
    await jobFromHandoff();                        // someone else's
    mine.technician = techId; await mine.save();

    const res = await as(techToken).get('/');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].jobNumber).toBe(mine.jobNumber);
  });

  it('a technician cannot log the customer’s satisfaction score', async () => {
    const job = await jobFromHandoff();
    expect((await as(techToken).post(`/${job._id}/feedback`, { csat: 5 })).status).toBe(403);
  });

  it('a technician cannot assign work to themselves', async () => {
    const job = await jobFromHandoff();
    expect((await as(techToken).post(`/${job._id}/plan`, { scheduledDate: new Date() })).status).toBe(403);
  });
});

describe('I1 → I2 — planning gate and the checklist engine', () => {
  it('refuses on_site until site readiness, technician, date and checklist are done', async () => {
    const job = await jobFromHandoff();
    const res = await as(imToken).post(`/${job._id}/advance`, { toStage: 'on_site' });

    expect(res.status).toBe(422);
    expect(res.body.missing.map((m) => m.field)).toEqual(expect.arrayContaining(
      ['siteReady.confirmedAt', 'technician', 'scheduledDate', 'checklists']));
  });

  it('passes once planning is complete', async () => {
    const job = await jobFromHandoff();
    await as(imToken).post(`/${job._id}/plan`, {
      technician: techId, technicianName: 'Tara', scheduledDate: new Date(),
      siteReadyConfirmedBy: 'Mr Sharma (plant head)',
    });
    await completeChecklist(job._id, 'planning', techToken);

    const res = await as(imToken).post(`/${job._id}/advance`, { toStage: 'on_site' });
    expect(res.status).toBe(200);
    expect(res.body.data.job.status).toBe('in_progress');
  });

  it('records WHO at the customer confirmed site readiness', async () => {
    const job = await jobFromHandoff();
    await as(imToken).post(`/${job._id}/plan`, { siteReadyConfirmedBy: 'Mr Sharma (plant head)' });
    const fresh = await InstallationJob.findById(job._id).lean();
    expect(fresh.siteReady.confirmedBy).toBe('Mr Sharma (plant head)');
    expect(fresh.siteReady.confirmedAt).toBeTruthy();
  });
});

describe('I2 → I3 — snags block commissioning', () => {
  async function onSite() {
    const job = await jobFromHandoff();
    await as(imToken).post(`/${job._id}/plan`, {
      technician: techId, technicianName: 'Tara', scheduledDate: new Date(),
      siteReadyConfirmedBy: 'Mr Sharma',
    });
    await completeChecklist(job._id, 'planning', techToken);
    await as(imToken).post(`/${job._id}/advance`, { toStage: 'on_site' });
    return job;
  }

  it('an open BLOCKER snag refuses commissioning', async () => {
    const job = await onSite();
    await completeChecklist(job._id, 'on_site', techToken, 'Tara');
    await as(techToken).post(`/${job._id}/snags`, { severity: 'blocker', description: 'Mains earthing absent' });

    const res = await as(imToken).post(`/${job._id}/advance`, { toStage: 'commissioning' });
    expect(res.status).toBe(422);
    expect(res.body.missing.map((m) => m.field)).toContain('snags');
  });

  it('a MINOR snag does not block — only major and blocker do', async () => {
    const job = await onSite();
    await completeChecklist(job._id, 'on_site', techToken, 'Tara');
    await as(techToken).post(`/${job._id}/snags`, { severity: 'minor', description: 'Scuffed panel' });

    expect((await as(imToken).post(`/${job._id}/advance`, { toStage: 'commissioning' })).status).toBe(200);
  });

  it('closing the blocker unblocks it', async () => {
    const job = await onSite();
    await completeChecklist(job._id, 'on_site', techToken, 'Tara');
    const snag = await as(techToken).post(`/${job._id}/snags`, { severity: 'major', description: 'Loose wiring' });
    await as(techToken).patch(`/${job._id}/snags/${snag.body.data._id}/close`, { resolution: 'Re-terminated' });

    expect((await as(imToken).post(`/${job._id}/advance`, { toStage: 'commissioning' })).status).toBe(200);
  });

  it('an UNSIGNED on-site checklist refuses commissioning', async () => {
    const job = await onSite();
    await completeChecklist(job._id, 'on_site', techToken);  // ticked, not signed
    const res = await as(imToken).post(`/${job._id}/advance`, { toStage: 'commissioning' });
    expect(res.status).toBe(422);
  });

  it('completing I2 stamps completedAt and derives firstTimeRight', async () => {
    const job = await onSite();
    await completeChecklist(job._id, 'on_site', techToken, 'Tara');
    await as(imToken).post(`/${job._id}/advance`, { toStage: 'commissioning' });

    const fresh = await InstallationJob.findById(job._id).lean();
    expect(fresh.completedAt).toBeTruthy();     // A13 anchor for install lead time
    expect(fresh.firstTimeRight).toBe(true);    // no retest, no blocking snag
  });
});

describe('I3 — the dual signature (I-9)', () => {
  async function atCommissioning() {
    const job = await jobFromHandoff();
    await as(imToken).post(`/${job._id}/plan`, {
      technician: techId, technicianName: 'Tara', scheduledDate: new Date(),
      siteReadyConfirmedBy: 'Mr Sharma',
    });
    await completeChecklist(job._id, 'planning', techToken);
    await as(imToken).post(`/${job._id}/advance`, { toStage: 'on_site' });
    await completeChecklist(job._id, 'on_site', techToken, 'Tara');
    await as(imToken).post(`/${job._id}/advance`, { toStage: 'commissioning' });
    await request(app).post(`/api/installations/${job._id}/upload`)
      .set('Authorization', `Bearer ${techToken}`)
      .field('docType', 'commissioning_report')
      .attach('file', PDF, { filename: 'report.pdf', contentType: 'application/pdf' });
    return job;
  }

  it('the TECHNICIAN signature alone does not satisfy the gate', async () => {
    const job = await atCommissioning();
    await as(techToken).post(`/${job._id}/commissioning`, { passed: true, technicianSigned: true });

    const res = await as(imToken).post(`/${job._id}/advance`, { toStage: 'handover_training' });
    expect(res.status).toBe(422);
    expect(res.body.missing.map((m) => m.field)).toContain('commissioning.customerCountersignedAt');
  });

  it('passes with both signatures and the report on file', async () => {
    const job = await atCommissioning();
    await as(techToken).post(`/${job._id}/commissioning`, {
      passed: true, technicianSigned: true, customerCountersigned: true,
      customerSignatory: 'Mr Sharma',
    });
    expect((await as(imToken).post(`/${job._id}/advance`, { toStage: 'handover_training' })).status).toBe(200);
  });

  it('a countersignature must name who signed', async () => {
    const job = await atCommissioning();
    const res = await as(techToken).post(`/${job._id}/commissioning`, {
      passed: true, customerCountersigned: true,
    });
    expect(res.status).toBe(400);
  });

  it('a failed test increments retestCount and kills firstTimeRight', async () => {
    const job = await atCommissioning();
    await as(techToken).post(`/${job._id}/commissioning`, { passed: false });

    const fresh = await InstallationJob.findById(job._id).lean();
    expect(fresh.commissioning.retestCount).toBe(1);
    expect(await Notification.countDocuments({ event: 'install.commissioning_failed' }))
      .toBeGreaterThan(0);
  });
});

describe('I6 — the closure gate (I-7, I-8)', () => {
  async function awaitingFeedback() {
    const job = await jobFromHandoff();
    job.stage = 'feedback';
    job.status = 'support';
    job.handover.handedOverAt = new Date();
    await job.save();
    return job;
  }

  it('refuses closure with no feedback at all', async () => {
    const job = await awaitingFeedback();
    const res = await as(csToken).post(`/${job._id}/close`);

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CLOSURE_GATE_FAILED');
    expect(res.body.missing.map((m) => m.field)).toContain('feedback.receivedAt');
  });

  it('closes on a healthy CSAT', async () => {
    const job = await awaitingFeedback();
    await as(csToken).post(`/${job._id}/feedback`, { csat: 4.5, comments: 'Smooth install' });

    const res = await as(csToken).post(`/${job._id}/close`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('closed');
    expect(res.body.data.closedAt).toBeTruthy();
  });

  it('a CSAT below 3.0 escalates and sets a 5-business-day clock', async () => {
    const job = await awaitingFeedback();
    const res = await as(csToken).post(`/${job._id}/feedback`, { csat: 2.5 });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/corrective action required/i);

    const fresh = await InstallationJob.findById(job._id).lean();
    expect(fresh.correctiveAction.required).toBe(true);
    expect(fresh.correctiveAction.dueAt).toBeTruthy();

    const n = await Notification.findOne({ event: 'install.csat_low' }).lean();
    expect(n.severity).toBe('critical');
  });

  it('REFUSES closure on a low CSAT until the plan is documented', async () => {
    const job = await awaitingFeedback();
    await as(csToken).post(`/${job._id}/feedback`, { csat: 2.5 });

    const blocked = await as(csToken).post(`/${job._id}/close`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.missing.map((m) => m.field)).toContain('correctiveAction.documentedAt');

    await as(csToken).post(`/${job._id}/corrective-action`, {
      plan: 'Site revisit booked; replacing the controller and retraining the operators.',
    });
    expect((await as(csToken).post(`/${job._id}/close`)).status).toBe(200);
  });

  it('rejects a CSAT outside the scale', async () => {
    const job = await awaitingFeedback();
    expect((await as(csToken).post(`/${job._id}/feedback`, { csat: 9 })).status).toBe(422);
  });
});

describe('I5 — support issues and their SLA', () => {
  it('flags an issue closed past its SLA', async () => {
    const job = await jobFromHandoff();
    const issue = await as(csToken).post(`/${job._id}/issues`, { description: 'Sensor drift' });

    await InstallationJob.collection.updateOne(
      { _id: job._id },
      { $set: { 'postSupport.issues.0.reportedAt': daysAgo(4) } });

    const res = await as(csToken).patch(`/${job._id}/issues/${issue.body.data._id}/resolve`,
      { resolution: 'Recalibrated' });
    expect(res.body.data.slaBreached).toBe(true);
    expect(res.body.message).toMatch(/SLA BREACHED/);
  });

  it('an issue closed inside the SLA is not flagged', async () => {
    const job = await jobFromHandoff();
    const issue = await as(csToken).post(`/${job._id}/issues`, { description: 'Question about the manual' });
    const res = await as(csToken).patch(`/${job._id}/issues/${issue.body.data._id}/resolve`, {});
    expect(res.body.data.slaBreached).toBe(false);
  });
});

describe('the installation sweeps', () => {
  it('dispatches the feedback form 14 days after handover, then reminds after 7 more (A14)', async () => {
    const job = await jobFromHandoff();
    job.handover.handedOverAt = daysAgo(20);
    job.status = 'support';
    await job.save();

    const first = await sweeps.feedbackDispatchSweep();
    expect(first.dispatched).toBe(1);

    /* The reminder clock runs from DISPATCH, not handover. */
    await InstallationJob.collection.updateOne(
      { _id: job._id }, { $set: { 'feedback.dispatchedAt': daysAgo(9) } });

    const second = await sweeps.feedbackDispatchSweep();
    expect(second.reminded).toBe(1);
  });

  it('flags an overdue corrective action plan', async () => {
    const job = await jobFromHandoff();
    job.correctiveAction = { required: true, dueAt: daysAgo(2), documentedAt: null, plan: '' };
    job.feedback.csat = 2;
    await job.save();

    const r = await sweeps.correctiveActionSweep();
    expect(r.flagged).toBe(1);
    expect(await Notification.countDocuments({
      user: managerId, event: 'install.corrective_action_overdue',
    })).toBe(1);
  });

  it('flags an overdue proactive check-in', async () => {
    const job = await jobFromHandoff();
    job.status = 'support';
    job.postSupport.checkInDueAt = daysAgo(1);
    await job.save();

    expect((await sweeps.checkInSweep()).flagged).toBe(1);
  });

  it('flags an unresolved issue past its SLA', async () => {
    const job = await jobFromHandoff();
    job.postSupport.issues.push({ description: 'No power', slaHours: pipeline.ISSUE_SLA_HOURS });
    await job.save();
    await InstallationJob.collection.updateOne(
      { _id: job._id }, { $set: { 'postSupport.issues.0.reportedAt': daysAgo(5) } });

    expect((await sweeps.issueSlaSweep()).flagged).toBe(1);
  });

  it('a quiet day flags nothing', async () => {
    await jobFromHandoff();
    const r = await sweeps.runInstallationSweeps();
    expect(r.checkIn.flagged + r.issues.flagged + r.corrective.flagged).toBe(0);
  });
});

describe('I-5 — the CSAT dashboard', () => {
  it('groups by technician with mean CSAT and first-time-right rate', async () => {
    const a = await jobFromHandoff();
    a.technicianName = 'Tara'; a.firstTimeRight = true;
    a.feedback = { receivedAt: new Date(), csat: 5, dispatchedAt: null, reminderSentAt: null, comments: '' };
    await a.save();

    const b = await jobFromHandoff();
    b.technicianName = 'Tara'; b.firstTimeRight = false;
    b.feedback = { receivedAt: new Date(), csat: 3, dispatchedAt: null, reminderSentAt: null, comments: '' };
    await b.save();

    const res = await as(imToken).get('/csat?groupBy=technician');
    expect(res.status).toBe(200);
    const tara = res.body.data.rows.find((r) => r.key === 'Tara');
    expect(tara).toMatchObject({ jobs: 2, meanCsat: 4, firstTimeRightRate: 50 });
  });

  it('rejects an unknown grouping', async () => {
    expect((await as(imToken).get('/csat?groupBy=nonsense')).status).toBe(400);
  });

  it('uploads a real file against a job', async () => {
    const job = await jobFromHandoff();
    const res = await request(app).post(`/api/installations/${job._id}/upload`)
      .set('Authorization', `Bearer ${techToken}`)
      .field('docType', 'handover_certificate')
      .attach('file', PNG, { filename: 'cert.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.data.sha256).toHaveLength(64);
  });
});
