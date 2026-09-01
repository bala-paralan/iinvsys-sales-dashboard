'use strict';
/**
 * kpiService.js — the 21 KPIs of docs/requirements/05-kpi-definitions.md.
 *
 * Three rules this module exists to keep:
 *
 *   1. **Targets are never written here.** Every target, unit, label and
 *      direction comes from `pipeline.KPI_TARGETS`. A number typed into this
 *      file is a second source of truth that will disagree with the settings
 *      screen the first time someone tunes a target.
 *
 *   2. **A ratio with a zero denominator is `null`, not `0`.** "0% on-time
 *      delivery" and "no deliveries yet" are different facts, and only one of
 *      them should turn a dashboard red.
 *
 *   3. **Windows are half-open `[from, to)` in Asia/Kolkata.** See
 *      `businessDays.monthWindow` for why.
 */

const Lead = require('../models/Lead');
const WorkOrder = require('../models/WorkOrder');
const InstallationJob = require('../models/InstallationJob');
const pipeline = require('../config/pipeline');
const { scopeFilter } = require('./scopeService');
const bd = require('../utils/businessDays');

/* ── window ──────────────────────────────────────────────────────────────── */

/**
 * Resolve `?from=&to=&period=` into a half-open window.
 *
 * Default is the **last complete calendar month**, which is what doc 05 means
 * by "trailing calendar month" and what its example window (`2026-07-01..
 * 2026-07-31`) shows. `period=current_month` gives month-to-date instead —
 * offered explicitly because a dashboard defaulting to last month looks stale
 * on the 28th, and the UI should be able to say which one it is asking for.
 *
 * `to` is INCLUSIVE in the query string (a human asking for `to=2026-07-31`
 * means "including the 31st") and exclusive internally.
 */
function resolveWindow(query = {}, now = new Date()) {
  const { from, to, period } = query;

  if (from || to) {
    const start = bd.dayStart(from);
    const endDay = bd.dayStart(to);
    if (!start && from) throw new RangeError('from must be an ISO date (YYYY-MM-DD)');
    if (!endDay && to) throw new RangeError('to must be an ISO date (YYYY-MM-DD)');
    const base = bd.monthWindow(now, 1);
    const f = start || base.from;
    const t = endDay ? new Date(endDay.getTime() + 86400000) : base.to;
    if (t <= f) throw new RangeError('to must not precede from');
    return {
      from: f,
      to: t,
      label: `${bd.isoDateInTz(f)}..${bd.isoDateInTz(new Date(t - 1))}`,
    };
  }

  if (period === 'current_month') return bd.monthWindow(now, 0);
  if (period && period !== 'last_month') {
    throw new RangeError('period must be last_month or current_month');
  }
  return bd.monthWindow(now, 1);
}

/* ── metric assembly ─────────────────────────────────────────────────────── */

const round = (n, dp = 1) => (n == null || Number.isNaN(n)
  ? null
  : Math.round(n * 10 ** dp) / 10 ** dp);

/**
 * `ok` when the target is met, `warn` within 10% of it, `breach` otherwise.
 *
 * Returns `null` — not `'ok'` — when there is no target or no data. A KPI with
 * `target: null` (pipeline value, sales cycle length) is a number to look at,
 * not a bar to clear, and reporting it green would be an invented pass.
 */
function statusOf(actual, def) {
  if (actual == null || def.target == null) return null;
  if (def.direction === 'max') {
    if (actual <= def.target) return 'ok';
    return actual <= def.target * 1.1 ? 'warn' : 'breach';
  }
  if (actual >= def.target) return 'ok';
  return actual >= def.target * 0.9 ? 'warn' : 'breach';
}

/**
 * Build one KPI envelope. `def` is looked up from KPI_TARGETS by process+key,
 * so a key with no target entry throws here rather than silently reporting a
 * KPI with no label.
 */
function metric(process, key, { actual, numerator = null, denominator = null }, window) {
  const def = (pipeline.KPI_TARGETS[process] || {})[key];
  if (!def) throw new Error(`No KPI_TARGETS entry for ${process}.${key}`);
  const value = round(actual, def.unit === 'score' ? 2 : 1);
  return {
    key,
    label: def.label,
    actual: value,
    target: def.target,
    unit: def.unit,
    direction: def.direction,
    status: statusOf(value, def),
    window: window.label,
    numerator,
    denominator,
  };
}

/** numerator/denominator as a percentage, or null when nothing qualified. */
const rate = (numerator, denominator) => (denominator > 0
  ? { actual: (numerator / denominator) * 100, numerator, denominator }
  : { actual: null, numerator, denominator });

const mean = (values) => (values.length
  ? { actual: values.reduce((a, b) => a + b, 0) / values.length, numerator: null, denominator: values.length }
  : { actual: null, numerator: null, denominator: 0 });

/* ── Process 1 — Sales ───────────────────────────────────────────────────── */

/**
 * Leads with a stageHistory entry INTO `stage` inside the window.
 *
 * Counts leads, not entries: a lead pushed back to Prospect and advanced again
 * entered Engagement twice, but it is one lead converting, and counting the
 * entry would let a single indecisive deal lift the rate above 100%.
 *
 * `transitionsOnly` excludes the opening "Lead created" entry (`from: null`).
 *
 * That distinction is what keeps a conversion rate below 100%. A lead created
 * straight into Prospect — bulk import, an expo backlog, a rep entering a deal
 * already in flight — has an entry into Prospect but never entered Suspect. In
 * the numerator it converts out of a cohort it was never in: on live seeded
 * data this reported Suspect-to-Prospect at **140%** (7 ÷ 5).
 *
 * So: DENOMINATORS count every way of reaching a stage, NUMERATORS count only
 * genuine transitions. A lead created mid-funnel then simply sits out the
 * conversion it was never part of, instead of inflating it.
 */
/**
 * Turn the caller's scope into a base filter per collection.
 *
 * v2's KPI endpoints took a window and nothing else, so every role holding `kpi.read`
 * received company-wide pipeline value, win rate and revenue — the exact thing doc 2
 * forbids in SA-MGR-01 and SA-DIR-01. Every query below now merges one of these.
 *
 * Work Orders carry no owner of their own (A24 — they hold a customerSnapshot, never a
 * lead reference for reading), so a scoped delivery figure is resolved through the
 * upstream leads once, here, rather than per metric.
 */
async function scopeBases(scope) {
  if (!scope || scope.userIds === null) return { lead: {}, workOrder: {}, installation: {} };

  const lead = scopeFilter(scope, 'owner');
  const mine = await Lead.find(lead).select('_id').lean();
  return {
    lead,
    workOrder: { lead: { $in: mine.map((l) => l._id) } },
    installation: scopeFilter(scope, 'technician'),
  };
}

function enteredStage(stage, window, { transitionsOnly = false, base = {} } = {}) {
  const entry = { to: stage, at: { $gte: window.from, $lt: window.to } };
  if (transitionsOnly) entry.from = { $ne: null };
  return Lead.countDocuments({ ...base, stageHistory: { $elemMatch: entry } });
}

const reachedStage = (stage, window, base) => enteredStage(stage, window, { base });
const convertedInto = (stage, window, base) => enteredStage(stage, window, { transitionsOnly: true, base });

async function salesKpis(window, scope = null) {
  const base = await scopeBases(scope);
  const [
    intoSuspect, intoProspect, intoEngagement, intoNegotiation, intoWon,
  ] = await Promise.all([
    reachedStage('suspect', window, base.lead),
    convertedInto('prospect', window, base.lead),
    reachedStage('engagement', window, base.lead),
    convertedInto('negotiation', window, base.lead),
    convertedInto(pipeline.WON_STAGE, window, base.lead),
  ]);

  /* negotiation is a numerator for prospect_to_proposal and a denominator for
     win_rate, so it is counted both ways. */
  const reachedNegotiation = await reachedStage('negotiation', window, base.lead);

  /* Sales cycle: won in the window, measured from creation to the WIN entry.
     Window membership is decided by the completion date (doc 05), so a deal
     that opened in March and closed in July is a July data point.

     Transitions only, for the same reason as the conversion rates: a lead
     imported as already-won has a zero-day "cycle" that is not a cycle at all,
     and a handful of them drag the mean toward zero. */
  const wonLeads = await Lead.find({
    ...base.lead,
    stageHistory: {
      $elemMatch: {
        to: pipeline.WON_STAGE, from: { $ne: null },
        at: { $gte: window.from, $lt: window.to },
      },
    },
  }).select('createdAt stageHistory').lean();

  const cycleDays = wonLeads.map((lead) => {
    const win = lead.stageHistory
      .filter((h) => h.to === pipeline.WON_STAGE && h.from != null
                  && h.at >= window.from && h.at < window.to)
      .sort((a, b) => a.at - b.at)[0];
    return win ? bd.calendarDaysBetween(lead.createdAt, win.at) : null;
  }).filter((d) => d != null && d >= 0);

  /* Pipeline value is a SNAPSHOT, not a window aggregate — "what is open right
     now". Bounding it by the window would report the value of deals that
     happened to move last month, which is not what a pipeline is. */
  const [openAgg] = await Lead.aggregate([
    { $match: { ...base.lead, stage: { $in: pipeline.OPEN_SALES_STAGES } } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        total: { $sum: { $ifNull: ['$value', 0] } },
        weighted: {
          $sum: {
            $multiply: [
              { $ifNull: ['$value', 0] },
              { $divide: [{ $ifNull: ['$probability', 0] }, 100] },
            ],
          },
        },
      },
    },
  ]);

  const [woTotal, woRevised] = await Promise.all([
    WorkOrder.countDocuments({ ...base.workOrder, createdAt: { $gte: window.from, $lt: window.to } }),
    WorkOrder.countDocuments({
      ...base.workOrder,
      createdAt: { $gte: window.from, $lt: window.to },
      revisionCount: { $gt: 0 },
    }),
  ]);

  return [
    metric('sales', 'suspect_to_prospect', rate(intoProspect, intoSuspect), window),
    metric('sales', 'prospect_to_proposal', rate(intoNegotiation, intoEngagement), window),
    metric('sales', 'win_rate', rate(intoWon, reachedNegotiation), window),
    metric('sales', 'sales_cycle_days', mean(cycleDays), window),
    metric('sales', 'pipeline_value', {
      actual: openAgg ? openAgg.total : 0,
      denominator: openAgg ? openAgg.count : 0,
    }, window),
    metric('sales', 'weighted_pipeline', {
      actual: openAgg ? openAgg.weighted : 0,
      denominator: openAgg ? openAgg.count : 0,
    }, window),
    metric('sales', 'po_accuracy', rate(woTotal - woRevised, woTotal), window),
  ];
}

/** Manager-dashboard counters from doc 05. Not KPIs — no targets, no status. */
async function salesHygieneCounters(now = new Date(), scope = null) {
  const base = await scopeBases(scope);
  const inactiveCutoff = new Date(
    now.getTime() - pipeline.INACTIVITY_ALERT_DAYS * 86400000);

  const [needingReview, inactive, missingFollowup, closeDateExpired] = await Promise.all([
    Lead.countDocuments({ ...base.lead, needsReview: true }),
    Lead.countDocuments({
      ...base.lead,
      stage: { $in: pipeline.OPEN_SALES_STAGES },
      $or: [{ lastContact: { $lt: inactiveCutoff } }, { lastContact: null }],
    }),
    Lead.countDocuments({
      ...base.lead,
      stage: { $in: pipeline.OPEN_SALES_STAGES },
      $or: [{ nextFollowUpDate: null }, { nextFollowUpDate: { $lt: now } }],
    }),
    Lead.countDocuments({
      ...base.lead,
      stage: { $in: pipeline.OPEN_SALES_STAGES },
      expectedCloseDate: { $ne: null, $lt: now },
    }),
  ]);

  /* stage_age_exceeded is a per-stage threshold, so it is the one counter that
     cannot be a single query — reviewIssues already carries the verdict from
     the last write, which is what the nightly sweep refreshes. */
  const stageAgeExceeded = await Lead.countDocuments({ ...base.lead, reviewIssues: 'stage_age_exceeded' });

  return {
    leads_needing_review: needingReview,
    leads_inactive_30d: inactive,
    leads_stage_age_exceeded: stageAgeExceeded,
    leads_missing_followup: missingFollowup,
    leads_close_date_expired: closeDateExpired,
  };
}

/* ── Process 2 — Delivery ────────────────────────────────────────────────── */

async function deliveryKpis(window, scope = null) {
  const base = await scopeBases(scope);
  const inWindow = { ...base.workOrder, deliveredAt: { $gte: window.from, $lt: window.to } };

  const delivered = await WorkOrder.find(inWindow)
    .select('deliveredAt originalCommittedDate deliveryAccuracy damageReported attachments')
    .lean();

  const onTime = delivered.filter(
    (w) => w.originalCommittedDate && w.deliveredAt <= w.originalCommittedDate).length;
  /* A delivery with no committed date cannot be on time OR late — it was never
     promised. Excluded from the denominator rather than silently counted as a
     miss, which would punish the team for a missing field twice. */
  const promised = delivered.filter((w) => w.originalCommittedDate).length;

  const accurate = delivered.filter(
    (w) => !w.deliveryAccuracy || !(w.deliveryAccuracy.discrepancies || []).length).length;

  const daComplete = delivered.filter(
    (w) => pipeline.hasDoc(w, 'delivery_acknowledgement') && pipeline.hasDoc(w, 'da_photo')).length;

  const damaged = delivered.filter((w) => w.damageReported).length;

  /* Date notification: committed within 1 business day of acceptance. Business
     days cannot be expressed in an aggregation pipeline, so this is computed
     per document — bounded by one month of acceptances. */
  const accepted = await WorkOrder.find({
    ...base.workOrder,
    acceptedAt: { $gte: window.from, $lt: window.to },
  }).select('acceptedAt committedDateSetAt').lean();

  const notifiedInTime = accepted.filter((w) => w.committedDateSetAt
    && bd.businessDaysBetween(w.acceptedAt, w.committedDateSetAt)
       <= pipeline.DELIVERY_DATE_SLA_BUSINESS_DAYS).length;

  /* Delay compliance counts EVENTS, not work orders: a work order delayed
     three times with one late notice is 2/3 compliant, not 0/1. */
  const [delayAgg] = await WorkOrder.aggregate([
    { $match: base.workOrder },
    { $unwind: '$delayEvents' },
    { $match: { 'delayEvents.at': { $gte: window.from, $lt: window.to } } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        compliant: {
          $sum: {
            $cond: [
              { $gte: ['$delayEvents.noticeHours', pipeline.DELAY_NOTICE_MIN_HOURS] }, 1, 0],
          },
        },
      },
    },
  ]);

  const dispatched = await WorkOrder.find({
    ...base.workOrder,
    dispatchedAt: { $gte: window.from, $lt: window.to },
  }).select('createdAt dispatchedAt').lean();
  const dispatchDays = dispatched
    .map((w) => bd.calendarDaysBetween(w.createdAt, w.dispatchedAt))
    .filter((d) => d >= 0);

  return [
    metric('delivery', 'on_time_delivery', rate(onTime, promised), window),
    metric('delivery', 'date_notification_rate', rate(notifiedInTime, accepted.length), window),
    metric('delivery', 'delay_notice_compliance',
      rate(delayAgg ? delayAgg.compliant : 0, delayAgg ? delayAgg.total : 0), window),
    metric('delivery', 'order_to_dispatch_days', mean(dispatchDays), window),
    metric('delivery', 'delivery_accuracy', rate(accurate, delivered.length), window),
    metric('delivery', 'da_completion', rate(daComplete, delivered.length), window),
    metric('delivery', 'damage_rate', rate(damaged, delivered.length), window),
  ];
}

/* ── Process 3 — Installation & Customer Service ─────────────────────────── */

async function installationKpis(window, scope = null) {
  const base = await scopeBases(scope);
  const completed = await InstallationJob.find({
    ...base.installation,
    completedAt: { $gte: window.from, $lt: window.to },
  }).select('completedAt firstTimeRight workOrder').populate('workOrder', 'deliveredAt').lean();

  /* Lead time runs from the DA (the Work Order's deliveredAt) to I2 close —
     A13. Jobs whose work order has no deliveredAt are excluded rather than
     measured from zero, which would report a 20,000-day lead time. */
  const leadTimes = completed
    .filter((j) => j.workOrder && j.workOrder.deliveredAt)
    .map((j) => bd.businessDaysBetween(j.workOrder.deliveredAt, j.completedAt))
    .filter((d) => d >= 0);

  const ftr = completed.filter((j) => j.firstTimeRight === true).length;

  const commissioned = await InstallationJob.find({
    ...base.installation,
    'commissioning.customerCountersignedAt': { $gte: window.from, $lt: window.to },
  }).select('commissioning').lean();
  const passedClean = commissioned.filter(
    (j) => j.commissioning.passed && j.commissioning.retestCount === 0).length;

  const handedOver = await InstallationJob.find({
    ...base.installation,
    'handover.handedOverAt': { $gte: window.from, $lt: window.to },
  }).select('attachments').lean();
  const withCert = handedOver.filter(
    (j) => pipeline.hasDoc(j, 'handover_certificate')).length;

  /* Issue resolution is per ISSUE, across every job with one closed in the
     window — the job itself may have opened months earlier. */
  const [issueAgg] = await InstallationJob.aggregate([
    { $match: base.installation },
    { $unwind: '$postSupport.issues' },
    { $match: { 'postSupport.issues.resolvedAt': { $gte: window.from, $lt: window.to } } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        meanHours: {
          $avg: {
            $divide: [
              { $subtract: ['$postSupport.issues.resolvedAt', '$postSupport.issues.reportedAt'] },
              3600000,
            ],
          },
        },
      },
    },
  ]);

  const [csatAgg] = await InstallationJob.aggregate([
    { $match: base.installation },
    { $match: { 'feedback.receivedAt': { $gte: window.from, $lt: window.to }, 'feedback.csat': { $ne: null } } },
    { $group: { _id: null, count: { $sum: 1 }, mean: { $avg: '$feedback.csat' } } },
  ]);

  /* Collection rate measures TIMELY return (A15): forms dispatched in the
     window that came back within 30 days. Eventual return is 100% by
     construction — the closure gate makes it so — which is why the 85% target
     can only be about promptness. */
  const dispatchedForms = await InstallationJob.find({
    ...base.installation,
    'feedback.dispatchedAt': { $gte: window.from, $lt: window.to },
  }).select('feedback.dispatchedAt feedback.receivedAt').lean();

  const returnedInTime = dispatchedForms.filter((j) => j.feedback.receivedAt
    && bd.calendarDaysBetween(j.feedback.dispatchedAt, j.feedback.receivedAt)
       <= pipeline.FEEDBACK_COLLECTION_WINDOW_DAYS).length;

  return [
    metric('installation', 'install_lead_time_days', mean(leadTimes), window),
    metric('installation', 'first_time_right', rate(ftr, completed.length), window),
    metric('installation', 'commissioning_pass', rate(passedClean, commissioned.length), window),
    metric('installation', 'handover_cert_rate', rate(withCert, handedOver.length), window),
    metric('installation', 'issue_resolution_hours', {
      actual: issueAgg ? issueAgg.meanHours : null,
      denominator: issueAgg ? issueAgg.count : 0,
    }, window),
    metric('installation', 'csat', {
      actual: csatAgg ? csatAgg.mean : null,
      denominator: csatAgg ? csatAgg.count : 0,
    }, window),
    metric('installation', 'feedback_collection',
      rate(returnedInTime, dispatchedForms.length), window),
  ];
}

module.exports = {
  resolveWindow, statusOf, metric, rate, mean,
  salesKpis, salesHygieneCounters, deliveryKpis, installationKpis,
};
