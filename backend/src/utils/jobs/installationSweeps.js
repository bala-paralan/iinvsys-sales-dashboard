'use strict';
/**
 * Installation & CS sweeps — I-3, I-4, I-8, I-10, I-11.
 *
 * All four clocks the framework sets running after handover:
 *   checkInSweep      I-10  proactive check-in within 7 days
 *   feedbackDispatch  I-3   dispatch within 14 days; I-4 remind after 7 more
 *   issueSlaSweep     I-11  issues open past their response SLA
 *   correctiveActionSweep  I-8  plans overdue against their 5-business-day clock
 *
 * Same shape as the other sweep modules: pure async functions over an injected
 * `now`, returning summaries. The scheduler owns the clock.
 */
const InstallationJob = require('../../models/InstallationJob');
const pipeline = require('../../config/pipeline');
const { recipientsFor, notifyOnce } = require('../../services/notificationService');

/** I-10 — the 7-day proactive check-in has come due and has not happened. */
async function checkInSweep(now = new Date()) {
  const due = await InstallationJob.find({
    status: 'support',
    'postSupport.checkInDueAt': { $ne: null, $lte: now },
    'postSupport.checkInDoneAt': null,
  }).select('jobNumber customerSnapshot').lean();

  if (!due.length) return { flagged: 0, notified: 0, suppressed: 0 };

  const recipients = await recipientsFor(['support.manage']);
  let notified = 0; let suppressed = 0;
  for (const job of due) {
    const r = await notifyOnce(recipients, {
      event: 'install.handover_complete',
      severity: 'warn',
      title: `Check-in overdue on ${job.jobNumber}`,
      body: `${job.customerSnapshot.company || job.customerSnapshot.name} — the proactive `
          + `${pipeline.CHECK_IN_DUE_DAYS}-day check-in has not been logged.`,
      entityType: 'installation', entityId: job._id,
    }, 24 * 3);
    notified += r.sent.length; suppressed += r.suppressed;
  }
  return { flagged: due.length, notified, suppressed };
}

/**
 * I-3 / I-4 — dispatch the feedback form within 14 days of handover, then
 * remind 7 days after DISPATCH (A14: from dispatch, not from handover —
 * measuring the reminder from handover would fire it before some dispatches).
 */
async function feedbackDispatchSweep(now = new Date()) {
  const dispatchCutoff = new Date(
    now.getTime() - pipeline.FEEDBACK_DISPATCH_DUE_DAYS * 86400000);

  const toDispatch = await InstallationJob.find({
    'handover.handedOverAt': { $ne: null, $lte: dispatchCutoff },
    'feedback.dispatchedAt': null,
    status: { $nin: ['closed', 'cancelled'] },
  }).select('jobNumber customerSnapshot');

  for (const job of toDispatch) {
    job.feedback.dispatchedAt = now;
    await job.save();
  }

  const reminderCutoff = new Date(
    now.getTime() - pipeline.FEEDBACK_REMINDER_DAYS * 86400000);
  const toRemind = await InstallationJob.find({
    'feedback.dispatchedAt': { $ne: null, $lte: reminderCutoff },
    'feedback.receivedAt': null,
    'feedback.reminderSentAt': null,
    status: { $nin: ['closed', 'cancelled'] },
  }).select('jobNumber customerSnapshot');

  const recipients = await recipientsFor(['feedback.log']);
  /* `reminded` counts JOBS, `notified` counts NOTIFICATIONS — one job reminds
     every CS user who holds feedback.log, so conflating them makes the
     scheduler's summary line ("3 reminded") mean something it does not. */
  let notified = 0;
  for (const job of toRemind) {
    job.feedback.reminderSentAt = now;
    await job.save();
    const r = await notifyOnce(recipients, {
      event: 'install.handover_complete',
      severity: 'info',
      title: `Feedback form unreturned on ${job.jobNumber}`,
      body: `${job.customerSnapshot.company || job.customerSnapshot.name} — `
          + `${pipeline.FEEDBACK_REMINDER_DAYS} days since dispatch. The job cannot close without it.`,
      entityType: 'installation', entityId: job._id,
    }, 24 * 7);
    notified += r.sent.length;
  }

  return { dispatched: toDispatch.length, reminded: toRemind.length, notified };
}

/** I-11 — support issues open past their response SLA. */
async function issueSlaSweep(now = new Date()) {
  const jobs = await InstallationJob.find({
    'postSupport.issues': { $elemMatch: { resolvedAt: null } },
  }).select('jobNumber customerSnapshot postSupport.issues').lean();

  const breaching = [];
  for (const job of jobs) {
    for (const issue of job.postSupport.issues) {
      if (issue.resolvedAt) continue;
      const hours = (now - new Date(issue.reportedAt)) / 3600000;
      if (hours > (issue.slaHours || pipeline.ISSUE_SLA_HOURS)) {
        breaching.push({ job, issue, hours: Math.round(hours) });
      }
    }
  }
  if (!breaching.length) return { flagged: 0, notified: 0, suppressed: 0 };

  const recipients = await recipientsFor(['support.manage', 'install.assign']);
  let notified = 0; let suppressed = 0;
  for (const { job, issue, hours } of breaching) {
    const r = await notifyOnce(recipients, {
      event: 'install.issue_sla_breached',
      severity: 'warn',
      title: `Support issue past SLA on ${job.jobNumber} (${hours}h)`,
      body: issue.description,
      entityType: 'installation', entityId: job._id,
      meta: { issueId: String(issue._id), hours, slaHours: issue.slaHours },
    }, 24);
    notified += r.sent.length; suppressed += r.suppressed;
  }
  return { flagged: breaching.length, notified, suppressed };
}

/** I-8 — corrective action plans past their 5-business-day clock. */
async function correctiveActionSweep(now = new Date()) {
  const overdue = await InstallationJob.find({
    'correctiveAction.required': true,
    'correctiveAction.documentedAt': null,
    'correctiveAction.dueAt': { $ne: null, $lte: now },
  }).select('jobNumber customerSnapshot feedback.csat correctiveAction.dueAt').lean();

  if (!overdue.length) return { flagged: 0, notified: 0, suppressed: 0 };

  const recipients = await recipientsFor(['feedback.corrective_action', 'lead.gate_override']);
  let notified = 0; let suppressed = 0;
  for (const job of overdue) {
    const r = await notifyOnce(recipients, {
      event: 'install.corrective_action_overdue',
      severity: 'critical',
      title: `Corrective action overdue on ${job.jobNumber} (CSAT ${job.feedback.csat})`,
      body: `${job.customerSnapshot.company || job.customerSnapshot.name} — the plan was due `
          + `${new Date(job.correctiveAction.dueAt).toDateString()} and the job cannot close without it.`,
      entityType: 'installation', entityId: job._id,
    }, 24);
    notified += r.sent.length; suppressed += r.suppressed;
  }
  return { flagged: overdue.length, notified, suppressed };
}

async function runInstallationSweeps(now = new Date()) {
  const checkIn = await checkInSweep(now);
  const feedback = await feedbackDispatchSweep(now);
  const issues = await issueSlaSweep(now);
  const corrective = await correctiveActionSweep(now);
  return { checkIn, feedback, issues, corrective };
}

module.exports = {
  checkInSweep, feedbackDispatchSweep, issueSlaSweep, correctiveActionSweep,
  runInstallationSweeps,
};
