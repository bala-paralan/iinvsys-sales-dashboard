'use strict';

const Lead = require('../models/Lead');
const User = require('../models/User');
const Approval = require('../models/Approval');
const pipeline = require('../config/pipeline');
const approvalService = require('./approvalService');
const notify = require('./notificationService');
const audit = require('./auditService');

/**
 * dealService — the two commercial decisions doc 2 puts behind an approval: how far the
 * price may move, and when an order becomes real enough to start building.
 *
 * Both run on the Phase 0 `Approval` model rather than a queue of their own, so the
 * Director's single approvals screen (SA-DIR-07) shows discounts and COs side by side
 * without joining two shapes.
 */

/* ── Discounts: SA-EX-06 → SA-MGR-08 → SA-DIR-07 ─────────────────────────── */

/**
 * Who decides a tier-N discount.
 *
 * Walks UP the requester's own reporting line to find the first person holding the
 * approving role, rather than picking any holder of it. Doc 2 is explicit that a
 * Sales Manager sees only their own team — routing Exec A's request to Manager 2
 * because they happened to be first in a `find()` would breach that in the one place
 * it matters most.
 */
async function approverFor(requester, tier) {
  const band = (pipeline.getActiveRules().discountTiers || pipeline.DISCOUNT_TIERS)
    .find((t) => t.tier === tier);
  if (!band || !band.approverRole) return null;

  let cursor = requester;
  const seen = new Set();
  while (cursor && cursor.reportsTo && !seen.has(String(cursor.reportsTo))) {
    seen.add(String(cursor.reportsTo));
    /* eslint-disable no-await-in-loop -- a chain is at most three deep */
    const next = await User.findById(cursor.reportsTo)
      .select('name role reportsTo isActive').lean();
    if (!next) return null;
    if (next.role === band.approverRole && next.isActive !== false) return next;
    cursor = next;
  }

  /* Nobody of that role above them. Fall back to any active holder — a deal should not
     be un-approvable because an org chart is half-filled — but say so, because a silent
     fallback here is how a Manager ends up approving another team's pricing. */
  const fallback = await User.findOne({ role: band.approverRole, isActive: true })
    .select('name role').lean();
  return fallback ? { ...fallback, viaFallback: true } : null;
}

/**
 * Request (or self-apply) a discount.
 *
 * @returns {{lead, approval: Document|null, selfApproved: boolean, approver}}
 */
async function requestDiscount(lead, { percent, justification, standardPrice }, requester) {
  const tierBand = pipeline.discountTierFor(percent);
  if (!tierBand) {
    throw Object.assign(new Error('That is not a valid discount percentage'), { code: 'BAD_DISCOUNT' });
  }

  const listPrice = Number(standardPrice) || lead.discount?.standardPrice || lead.value || 0;

  lead.discount.percent = Number(percent);
  lead.discount.justification = justification || '';
  lead.discount.standardPrice = listPrice;
  lead.discount.tier = tierBand.tier;

  /* Tier 1 — the executive's own authority. No approval document, because there is no
     decision for anyone to make, and a queue full of auto-approved rows is noise that
     buries the ones that need a person. */
  if (!tierBand.approverRole) {
    lead.discount.status = 'self_approved';
    lead.discount.approval = null;
    lead.discount.decidedBy = requester._id;
    lead.discount.decidedAt = new Date();
    applyPrice(lead);
    await lead.save();
    await audit.record({
      action: 'record.update',
      entityType: 'lead',
      entityId: lead._id,
      summary: `${lead.refId || lead.name}: ${percent}% discount self-approved`,
      meta: { percent, tier: tierBand.tier, standardPrice: listPrice, value: lead.value },
    });
    return { lead, approval: null, selfApproved: true, approver: null };
  }

  const approver = await approverFor(requester, tierBand.tier);
  if (!approver) {
    throw Object.assign(
      new Error(`No ${tierBand.approverRole.replace(/_/g, ' ')} available to approve a ${percent}% discount`),
      { code: 'NO_APPROVER' },
    );
  }

  const approval = await approvalService.request({
    kind: 'discount',
    subject: { model: 'Lead', id: lead._id },
    tier: tierBand.tier,
    assignedTo: approver._id,
    payload: {
      refId: lead.refId,
      name: lead.name,
      company: lead.company,
      percent: Number(percent),
      justification: justification || '',
      standardPrice: listPrice,
      discountedPrice: discounted(listPrice, percent),
      marginImpact: discounted(listPrice, percent) - listPrice,
      band: tierBand.label,
    },
  }, requester);

  lead.discount.status = 'pending';
  lead.discount.approval = approval._id;
  await lead.save();

  return { lead, approval, selfApproved: false, approver };
}

/**
 * Record a decision on a discount and price the deal accordingly.
 *
 * `counterPercent` is doc 2's "Counter: Approve 5%" — the approver grants a different
 * number rather than refusing outright, which is what actually happens in a negotiation.
 */
async function decideDiscount(approval, decider, { status, counterPercent, note = '' }) {
  const lead = await Lead.findById(approval.subject.id);
  if (!lead) throw Object.assign(new Error('The deal behind this request no longer exists'), { code: 'NO_SUBJECT' });

  const granted = status === 'approved'
    ? (counterPercent === undefined || counterPercent === null
      ? approval.payload.percent
      : Number(counterPercent))
    : 0;

  if (status === 'approved') {
    /* A counter may not exceed the approver's own authority — otherwise the 3–10% band
       is advisory, and a Manager could grant 15% by countering upward. */
    const band = pipeline.discountTierFor(granted);
    if (!band || band.tier > approval.tier) {
      throw Object.assign(
        new Error(`${granted}% is above the authority of this approval band`),
        { code: 'ABOVE_AUTHORITY' },
      );
    }
    lead.discount.percent = granted;
    lead.discount.status = 'approved';
    applyPrice(lead);
  } else {
    lead.discount.percent = 0;
    lead.discount.status = status === 'returned' ? 'none' : 'rejected';
    applyPrice(lead);
  }

  lead.discount.decidedBy = decider._id;
  lead.discount.decidedAt = new Date();
  await lead.save();

  await approvalService.decide(approval, decider, {
    status,
    decision: status === 'approved' ? `${granted}%` : '',
    note,
  });

  await audit.record({
    action: 'record.update',
    entityType: 'lead',
    entityId: lead._id,
    summary: `${lead.refId || lead.name}: ${approval.payload.percent}% discount ${status}`
      + (granted && granted !== approval.payload.percent ? ` (countered to ${granted}%)` : ''),
    meta: { requested: approval.payload.percent, granted, status, tier: approval.tier },
  });

  return { lead, approval };
}

/** Price the deal from its list price and the granted discount. */
function applyPrice(lead) {
  const list = lead.discount?.standardPrice || 0;
  if (!list) return;                       // nothing quoted yet — leave `value` alone
  lead.value = discounted(list, lead.discount.percent || 0);
}

const discounted = (list, percent) => Math.round(list * (1 - (Number(percent) || 0) / 100));

/* ── Commercial Order: SA-EX-07 → SA-DIR-09 ──────────────────────────────── */

/**
 * An executive submits the CO for the Director to confirm.
 *
 * Deliberately NOT the stage transition. Reaching `commercial_order` still runs the
 * existing gate (a PO document, a PO number, subscription and AMC answers); this is the
 * commercial sign-off ON TOP of it, and it is what fires Production.
 */
async function submitCommercialOrder(lead, { poValue, note = '' }, requester) {
  if (lead.co?.confirmedAt) {
    throw Object.assign(new Error('This order has already been confirmed'), { code: 'ALREADY_CONFIRMED' });
  }

  /*
   * THE STAGE GATE IS A PRECONDITION, not a parallel path.
   *
   * Confirming a CO fires Handoff 1, so without this a Director could raise a production
   * order for a deal still in Negotiation — one with no PO document, no PO number and no
   * subscription or AMC answer. That is the H-1 guarantee ("Delivery not activatable
   * without a confirmed and verified PO") routed around by a different endpoint, which is
   * exactly how a gate stops meaning anything.
   *
   * Reaching `commercial_order` still runs the full entry gate on the advance endpoint.
   * This sign-off sits ON TOP of it and answers a different question: not "is the
   * paperwork complete" but "does the Director agree we build this".
   */
  if (lead.stage !== pipeline.WON_STAGE) {
    throw Object.assign(
      new Error('Advance the deal to Commercial Order first — its gate checks the PO document, '
        + 'PO number and the subscription and AMC answers'),
      { code: 'GATE_NOT_PASSED' },
    );
  }
  if (lead.co?.approval) {
    const open = await Approval.findById(lead.co.approval).lean();
    if (open && open.status === 'pending') return { lead, approval: open, created: false };
  }

  const director = await approverFor(requester, 3)
    || await User.findOne({ role: 'sales_director', isActive: true }).select('name role').lean();
  if (!director) {
    throw Object.assign(new Error('No Sales Director available to confirm this order'), { code: 'NO_APPROVER' });
  }

  const approval = await approvalService.request({
    kind: 'co_confirm',
    subject: { model: 'Lead', id: lead._id },
    assignedTo: director._id,
    payload: {
      refId: lead.refId, name: lead.name, company: lead.company,
      poNumber: lead.poNumber, poValue: Number(poValue) || lead.value || 0,
      discountPercent: lead.discount?.percent || 0, note,
    },
  }, requester);

  lead.co.submittedAt = new Date();
  lead.co.submittedBy = requester._id;
  lead.co.approval = approval._id;
  lead.co.poValue = Number(poValue) || lead.value || 0;
  await lead.save();

  return { lead, approval, created: true };
}

/**
 * The Director confirms — and Production starts.
 *
 * Handoff 1 is the EXISTING `processHandoffService.createWorkOrderForLead`, not a second
 * path: it is already idempotent through a unique index plus a back-pointer, and already
 * repaired nightly by `ensureWorkOrderExists`. Firing it from here rather than
 * reimplementing is what keeps one definition of "a Work Order exists for this deal".
 */
async function confirmCommercialOrder(approval, director, { note = '' } = {}, req) {
  const lead = await Lead.findById(approval.subject.id).populate('products', 'name sku price');
  if (!lead) throw Object.assign(new Error('The deal behind this order no longer exists'), { code: 'NO_SUBJECT' });

  if (lead.co.confirmedAt) {
    await approvalService.decide(approval, director, { status: 'approved', note });
    return { lead, workOrder: null, alreadyConfirmed: true };
  }

  lead.co.confirmedAt = new Date();
  lead.co.confirmedBy = director._id;
  await lead.save();

  const { createWorkOrderForLead } = require('./processHandoffService');
  const workOrder = await createWorkOrderForLead(lead, req);

  await approvalService.decide(approval, director, { status: 'approved', note });

  await notify.notifyUser(lead.owner, {
    event: 'lead.stage_advanced',
    severity: 'info',
    title: `Commercial Order confirmed — ${lead.company || lead.name}`,
    body: workOrder
      ? `Production order ${workOrder.woNumber} has been raised.`
      : 'Production will be notified shortly.',
    reason: 'You own this deal.',
    entityType: 'lead',
    entityId: lead._id,
  });

  await audit.record({
    action: 'record.update',
    entityType: 'lead',
    entityId: lead._id,
    summary: `${lead.refId || lead.name}: Commercial Order confirmed by ${director.name}`,
    meta: { poNumber: lead.poNumber, poValue: lead.co.poValue, workOrder: workOrder ? String(workOrder._id) : null },
  }, req);

  return { lead, workOrder, alreadyConfirmed: false };
}

module.exports = {
  requestDiscount, decideDiscount, approverFor,
  submitCommercialOrder, confirmCommercialOrder,
  applyPrice, discounted,
};
