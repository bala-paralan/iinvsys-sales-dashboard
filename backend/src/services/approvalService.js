'use strict';

const Approval = require('../models/Approval');
const User     = require('../models/User');
const notify   = require('./notificationService');

/**
 * approvalService — request and decide, for all five approval kinds.
 *
 * The important behaviour here is that an approval is addressed to ONE PERSON.
 * notificationService.notifyByPermission fans out to every active holder of a permission,
 * which is right for "a work order needs accepting" and badly wrong for "Exec A wants 7%
 * off": that would alert all four Sales Managers and the whole director tier for a
 * decision only one of them can take.
 */

/** Who decides this request: the requester's manager, unless the caller names someone. */
async function defaultApprover(requester, { escalate = false } = {}) {
  if (!requester.reportsTo) return null;
  if (!escalate) return requester.reportsTo;
  const mgr = await User.findById(requester.reportsTo).select('reportsTo').lean();
  return mgr ? mgr.reportsTo : null;
}

async function request({ kind, subject, tier = null, payload = {}, assignedTo }, requester) {
  const approver = assignedTo || await defaultApprover(requester);
  if (!approver) {
    throw Object.assign(
      new Error('No approver: this account has no one to report to'),
      { code: 'NO_APPROVER' },
    );
  }

  const approval = await Approval.create({
    kind, subject, tier, payload,
    requestedBy: requester._id,
    assignedTo: approver,
  });

  await notify.notifyUser(approver, {
    event: 'approval.requested',
    severity: 'warn',
    title: `${kind.replace(/_/g, ' ')} approval requested`,
    body: `${requester.name} is waiting on your decision.`,
    reason: 'It is addressed to you as the approver on this request.',
    entityType: 'approval', entityId: approval._id,
  });

  return approval;
}

/**
 * Decide an approval. `status` is one of approved | returned | rejected.
 * `escalate()` is separate because it moves the request rather than closing it.
 */
async function decide(approval, decider, { status, decision = '', note = '' }) {
  approval.status = status;
  approval.decidedBy = decider._id;
  approval.decidedAt = new Date();
  approval.decision = decision;
  approval.note = note;
  await approval.save();

  await notify.notifyUser(approval.requestedBy, {
    event: 'approval.decided',
    severity: status === 'approved' ? 'info' : 'warn',
    title: `Your ${approval.kind.replace(/_/g, ' ')} request was ${status}`,
    body: note || decision || '',
    reason: 'You raised this request.',
    entityType: 'approval', entityId: approval._id,
  });

  return approval;
}

/** Pass the decision one level up the chain — doc 1 IS-HD-04, doc 2 SA-MGR-08. */
async function escalate(approval, actor, { note = '' } = {}) {
  const requester = await User.findById(approval.requestedBy).select('reportsTo name').lean();
  const next = await defaultApprover(requester || actor, { escalate: true })
    || (actor.reportsTo || null);
  if (!next) {
    throw Object.assign(
      new Error('Nowhere to escalate to: no one above this approver'),
      { code: 'NO_ESCALATION_TARGET' },
    );
  }

  approval.status = 'escalated';
  approval.escalatedTo = next;
  approval.assignedTo = next;
  approval.note = note;
  await approval.save();

  await notify.notifyUser(next, {
    event: 'approval.escalated',
    severity: 'critical',
    title: `Escalated: ${approval.kind.replace(/_/g, ' ')} approval`,
    body: note || `${actor.name} escalated this to you.`,
    reason: 'It was escalated to you as the next approver.',
    entityType: 'approval', entityId: approval._id,
  });

  return approval;
}

module.exports = { request, decide, escalate, defaultApprover };
