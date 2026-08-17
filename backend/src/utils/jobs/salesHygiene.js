'use strict';
/**
 * Nightly sales hygiene sweeps — S-7 and C-5.
 *
 * Three jobs, all pure functions of the database that return a summary rather
 * than logging one, so they are directly testable without a scheduler.
 *
 *   reevaluateHygiene  — recompute needsReview/reviewIssues across open leads
 *   salesInactivity    — S-7: flag leads with no activity for 30+ days
 *   weeklyNote         — C-5: Engagement+ deals with no note in 7 days
 *
 * ── Why re-evaluation is a job and not only a hook ───────────────────────
 * The model recomputes hygiene on every write, but half the rules are about
 * the PASSAGE OF TIME, not about an edit: an expected close date that has
 * quietly gone past, a follow-up date that lapsed, a lead that has sat at one
 * stage beyond its limit. Nobody writes to those records — that IS the
 * problem — so without a sweep the review queue only ever contains leads
 * somebody recently touched, which is exactly the wrong set.
 */
const Lead = require('../../models/Lead');
const pipeline = require('../../config/pipeline');
const { recipientsFor, notifyOnce } = require('../../services/notificationService');

/** Leads still in play — terminal stages are nobody's worklist. */
const OPEN = { stage: { $in: pipeline.OPEN_SALES_STAGES } };

/**
 * Recompute hygiene flags for every open lead.
 * Writes only where the result actually changed, so a quiet night is a cheap
 * night and `updatedAt` does not churn across the whole collection.
 */
async function reevaluateHygiene(now = new Date()) {
  const leads = await Lead.find(OPEN).lean();
  const ops = [];

  for (const lead of leads) {
    const codes = pipeline.hygieneIssues(lead, now).map((i) => i.code);
    if (codes.join('|') === (lead.reviewIssues || []).join('|')) continue;

    ops.push({
      updateOne: {
        filter: { _id: lead._id },
        update: { $set: { reviewIssues: codes, needsReview: codes.length > 0 } },
        /* Two deliberate choices, both about not corrupting other signals:
           · updateOne bypasses the pre('validate') hook, which would otherwise
             immediately recompute these codes against `new Date()` and discard
             the sweep's result — the whole point being that this run may be
             evaluating a clock the document has never been saved under.
           · timestamps:false so a hygiene re-flag does not bump `updatedAt`.
             A record the system flagged has NOT been worked on, and letting a
             sweep masquerade as activity would hide exactly the dormant leads
             the inactivity job exists to surface. */
        timestamps: false,
      },
    });
  }

  if (ops.length) await Lead.bulkWrite(ops, { ordered: false });
  return { scanned: leads.length, changed: ops.length };
}

/**
 * S-7 — "Auto-flag to Sales Manager if an opportunity has had no activity for
 * 30 or more days." Addressed to whoever holds `lead.gate_override`, which is
 * the permission that marks a manager rather than a rep.
 */
async function salesInactivity(now = new Date()) {
  const rules = pipeline.getActiveRules();
  const cutoff = new Date(now.getTime() - rules.inactivityAlertDays * 86400000);

  const stale = await Lead.find({
    ...OPEN,
    $or: [
      { lastContact: { $lt: cutoff } },
      { lastContact: null, stageEnteredAt: { $lt: cutoff } },
    ],
  }).select('name company stage lastContact stageEnteredAt ownerUser assignedAgent').lean();

  if (!stale.length) return { flagged: 0, notified: 0, suppressed: 0 };

  const managers = await recipientsFor(['lead.gate_override']);
  let notified = 0;
  let suppressed = 0;

  for (const lead of stale) {
    const since = lead.lastContact || lead.stageEnteredAt;
    const days = since ? Math.floor((now - new Date(since)) / 86400000) : null;

    const result = await notifyOnce(managers, {
      event: 'lead.inactive',
      severity: 'critical',
      title: `No activity on "${lead.name}" for ${days} days`,
      body: `${lead.company || 'Unknown company'} — sitting at `
          + `${pipeline.stageLabel(pipeline.SALES_STAGES, lead.stage)}.`,
      entityType: 'lead',
      entityId: lead._id,
      meta: { days, stage: lead.stage },
    }, 24 * 7); /* Weekly, not nightly — see notifyOnce. Telling a manager about
                   the same dormant lead every morning trains them to ignore the
                   feed, which costs more than the alert is worth. */

    notified += result.sent.length;
    suppressed += result.suppressed;
  }

  return { flagged: stale.length, notified, suppressed };
}

/**
 * C-5 — "Minimum one note per week for every deal at Engagement and above."
 * The staleness itself is already computed by hygieneIssues (`stale_notes`);
 * this job turns it into an alert for the deal's owner.
 */
async function weeklyNote(now = new Date()) {
  const stale = await Lead.find({
    ...OPEN,
    reviewIssues: 'stale_notes',
  }).select('name company stage ownerUser assignedAgent').lean();

  if (!stale.length) return { flagged: 0, notified: 0, suppressed: 0 };

  /* Owner first; fall back to managers when a lead has no linked User, which
     is the norm for anything captured by a referrer. */
  const managers = await recipientsFor(['lead.gate_override']);
  let notified = 0;
  let suppressed = 0;

  for (const lead of stale) {
    const targets = lead.ownerUser ? [{ _id: lead.ownerUser }] : managers;

    const result = await notifyOnce(targets, {
      event: 'lead.notes_stale',
      severity: 'warn',
      title: `"${lead.name}" needs a note this week`,
      body: `${pipeline.stageLabel(pipeline.SALES_STAGES, lead.stage)} deals need `
          + 'one note per week.',
      entityType: 'lead',
      entityId: lead._id,
      meta: { stage: lead.stage },
    }, 24 * 7);

    notified += result.sent.length;
    suppressed += result.suppressed;
  }

  return { flagged: stale.length, notified, suppressed };
}

/**
 * The nightly run. Re-evaluation goes FIRST so the two alert jobs read flags
 * that reflect today, not whenever the record was last edited.
 */
async function runNightly(now = new Date()) {
  const hygiene = await reevaluateHygiene(now);
  const inactivity = await salesInactivity(now);
  const notes = await weeklyNote(now);
  /* H-3 repair pass: a won lead with no Work Order means Handoff 1 failed at
     transition time (it is deliberately non-fatal there). Close the gap here
     rather than letting it persist silently. */
  const { ensureWorkOrderExists, ensureInstallationJobExists } = require('../../services/handoffService');
  const handoffs = await ensureWorkOrderExists();
  const handoffs2 = await ensureInstallationJobExists();
  return { hygiene, inactivity, notes, handoffs, handoffs2 };
}

module.exports = { reevaluateHygiene, salesInactivity, weeklyNote, runNightly, OPEN };
