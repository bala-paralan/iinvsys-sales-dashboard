'use strict';
/**
 * Delivery SLA sweeps — D-2, A11.
 *
 * A11 splits one ambiguous sentence into two separately-tracked clocks:
 *   1. ACCEPTANCE: a Work Order must be accepted within 1 business day of
 *      creation.
 *   2. DATE CONFIRMATION: the target delivery date must be committed within
 *      1 business day of ACCEPTANCE.
 * Tracking them separately is the point — neither reading of the framework's
 * wording is lost, and each breach names what actually stalled.
 *
 * Same shape as salesHygiene: pure async functions taking an injected `now`,
 * returning summaries. The scheduler owns the clock; these own the logic.
 */
const WorkOrder = require('../../models/WorkOrder');
const pipeline = require('../../config/pipeline');
const { isPastBusinessDays } = require('../businessDays');
const { recipientsFor, notifyOnce } = require('../../services/notificationService');

const SLA_DAYS = pipeline.DELIVERY_DATE_SLA_BUSINESS_DAYS;

/** Work Orders created but not accepted within the SLA. */
async function unacceptedSweep(now = new Date()) {
  const open = await WorkOrder.find({ acceptedAt: null, status: 'created' })
    .select('woNumber customerSnapshot createdAt').lean();

  const breaches = open.filter((wo) => isPastBusinessDays(wo.createdAt, SLA_DAYS, now));
  if (!breaches.length) return { flagged: 0, notified: 0, suppressed: 0 };

  const recipients = await recipientsFor(['workorder.accept']);
  let notified = 0; let suppressed = 0;

  for (const wo of breaches) {
    const r = await notifyOnce(recipients, {
      event: 'delivery.date_unconfirmed',
      severity: 'critical',
      title: `${wo.woNumber} still unaccepted past the 1-business-day SLA`,
      body: `${wo.customerSnapshot.company || wo.customerSnapshot.name} is waiting for a Delivery Manager.`,
      entityType: 'workorder', entityId: wo._id,
      meta: { kind: 'acceptance', createdAt: wo.createdAt },
    });
    notified += r.sent.length; suppressed += r.suppressed;
  }
  return { flagged: breaches.length, notified, suppressed };
}

/** Accepted Work Orders whose delivery date was never committed within the SLA. */
async function dateUnconfirmedSweep(now = new Date()) {
  const accepted = await WorkOrder.find({
    acceptedAt: { $ne: null }, committedDateSetAt: null,
    status: { $nin: ['delivered', 'cancelled'] },
  }).select('woNumber customerSnapshot acceptedAt').lean();

  const breaches = accepted.filter((wo) => isPastBusinessDays(wo.acceptedAt, SLA_DAYS, now));
  if (!breaches.length) return { flagged: 0, notified: 0, suppressed: 0 };

  /* D-2's own escalation list: Delivery Manager, Sales Manager, lead owner.
     Permissions, not names: acceptors + sales managers. */
  const recipients = await recipientsFor(['workorder.accept', 'lead.gate_override']);
  let notified = 0; let suppressed = 0;

  for (const wo of breaches) {
    const r = await notifyOnce(recipients, {
      event: 'delivery.date_unconfirmed',
      severity: 'critical',
      title: `${wo.woNumber}: no delivery date committed within 1 business day of acceptance`,
      body: `${wo.customerSnapshot.company || wo.customerSnapshot.name} has no confirmed target date (D-2).`,
      entityType: 'workorder', entityId: wo._id,
      meta: { kind: 'date_confirmation', acceptedAt: wo.acceptedAt },
    });
    notified += r.sent.length; suppressed += r.suppressed;
  }
  return { flagged: breaches.length, notified, suppressed };
}

async function runDeliverySweeps(now = new Date()) {
  const unaccepted = await unacceptedSweep(now);
  const dateUnconfirmed = await dateUnconfirmedSweep(now);
  return { unaccepted, dateUnconfirmed };
}

module.exports = { unacceptedSweep, dateUnconfirmedSweep, runDeliverySweeps };
