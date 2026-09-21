'use strict';

/**
 * leadTransferService — the ONE place a lead changes hands after creation.
 *
 * SPENCO CRM brief §5 is a matrix: who may transfer, and to whom. Before this, the IS
 * track had an assign endpoint with a scope check, the Sales track had none, and a
 * Director could swap `owner` through PUT /leads/:id with no audit row and no
 * notification. Three doors, three behaviours. Now there is one door, and it writes
 * the ownership log the brief's §7 makes mandatory.
 *
 * The rules, as data in config/permissions.js (TRANSFER_TARGETS):
 *
 *   SD   → anyone
 *   ISM  → ZSM or ASM        (an Inside Sales lead crossing into Sales — see below)
 *   ZSM  → ASM in their zone
 *   ASM  → SE in their area
 *   ISE, SE → nobody; they raise a `transfer` approval to their manager instead
 *
 * "In their zone / area" is "in their reporting subtree": scopeService already answers
 * that, and it is the same boundary every list and KPI uses. A separate zone check would
 * be a second boundary that could disagree with the first.
 *
 * CROSSING TRACKS. An ISM's targets are Sales roles, so the lead they hand over is an
 * Inside Sales record becoming a SPENCO deal. That is a mint, not an owner swap —
 * salesEntryService.mintSalesLead() is the only way into SPENCO and stays so. The
 * reverse (a deal back to Inside Sales) is not a move the brief describes, so it is
 * refused rather than guessed at.
 */

const Lead     = require('../models/Lead');
const User     = require('../models/User');
const Approval = require('../models/Approval');
const pipeline = require('../config/pipeline');
const { TRANSFER_TARGETS, INSIDE_SALES_ONLY_ROLES, ROLE_LABELS } = require('../config/permissions');
const { scopeAllows, resolveScope } = require('./scopeService');
const salesEntry = require('./salesEntryService');
const approvalService = require('./approvalService');
const notify = require('./notificationService');
const audit  = require('./auditService');

const IS_ROLES    = ['inside_sales_manager', 'inside_sales_executive'];
const SALES_ROLES = ['sales_director', 'zonal_sales_manager', 'area_sales_manager', 'sales_executive'];

const fail = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra });

/** Roles that may hold `lead` — an Inside Sales record stays with IS people or crosses over. */
function rolesEligibleFor(lead) {
  return lead.track === 'inside_sales' ? [...IS_ROLES, ...SALES_ROLES] : SALES_ROLES;
}

/**
 * The roles `actor` may transfer `lead` to, per the matrix, narrowed to what the lead
 * can accept. `null` means every eligible role.
 */
function targetRolesFor(actor, lead) {
  const row = TRANSFER_TARGETS[actor.role];
  const eligible = rolesEligibleFor(lead);
  if (row === undefined) return actor.role === 'superadmin' ? eligible : [];
  if (row === null) return eligible;
  return row.filter((r) => eligible.includes(r));
}

/**
 * Does the subtree rule apply to this actor? An ISM's targets are Sales people, who are
 * never in an ISM's subtree — the crossing IS the rule. Everyone else transfers within
 * their own team.
 */
function withinSubtree(actor) {
  return !INSIDE_SALES_ONLY_ROLES.includes(actor.role);
}

/**
 * Everyone `actor` may hand `lead` to right now — the picker. Empty for an ISE/SE by
 * construction, which is what the client reads as "escalate instead".
 */
async function targetsFor(actor, scope, lead) {
  const roles = targetRolesFor(actor, lead);
  if (roles.length === 0) return [];
  const filter = { role: { $in: roles }, isActive: true, _id: { $ne: lead.owner } };
  if (withinSubtree(actor) && scope.userIds !== null) filter._id.$in = scope.userIds;
  return User.find(filter).select('name role zone domain initials color reportsTo').sort({ role: 1, name: 1 }).lean();
}

/** The one notification the assignee gets, whichever door the transfer came through. */
async function notifyAssignee(userId, lead, note, { reason = 'It was assigned to you.' } = {}) {
  return notify.notifyUser(userId, {
    event: 'lead.assigned',
    severity: lead.priority === 'hot' ? 'critical' : 'warn',
    title: `New lead: ${lead.name}${lead.company ? ` — ${lead.company}` : ''}`,
    body: note || `${lead.refId} · priority ${lead.priority || 'normal'}`,
    reason,
    entityType: 'lead',
    entityId: lead._id,
  });
}

/**
 * Move `lead` to user `to` on behalf of `actor`.
 *
 * @returns {{ lead, salesLead: Lead|null, crossedTrack: boolean }} — `salesLead` is the
 *   SPENCO deal minted when an Inside Sales lead crosses into Sales; `lead` is always
 *   the record the caller passed in (now converted, in that case).
 */
async function transfer(lead, { to, actor, scope, note = '', req } = {}) {
  if (!to) throw fail('Say who the lead goes to', 'NO_TARGET');
  if (String(to) === String(lead.owner)) throw fail('That person already owns this lead', 'SAME_OWNER');

  const roles = targetRolesFor(actor, lead);
  if (roles.length === 0) {
    throw fail(
      `A ${ROLE_LABELS[actor.role] || actor.role} cannot transfer leads — ask your manager`,
      'CANNOT_TRANSFER',
    );
  }

  const target = await User.findById(to).select('name role isActive').lean();
  if (!target || !target.isActive) throw fail('That person does not exist or is inactive', 'NO_SUCH_USER');
  if (!roles.includes(target.role)) {
    throw fail(
      `A ${ROLE_LABELS[actor.role] || actor.role} may only transfer to: ${roles.map((r) => ROLE_LABELS[r]).join(', ')}`,
      'TARGET_ROLE',
    );
  }
  if (withinSubtree(actor) && !scopeAllows(scope, target._id)) {
    throw fail(`${target.name} is not in your ${actor.role === 'zonal_sales_manager' ? 'zone' : 'team'}`, 'OUT_OF_SCOPE');
  }

  const previous = lead.owner ? await User.findById(lead.owner).select('name').lean() : null;
  const entry = {
    kind: lead.owner ? 'transferred' : 'assigned',
    from: lead.owner || null, fromName: previous ? previous.name : '',
    to: target._id, toName: target.name,
    by: actor._id, byName: actor.name || '',
    at: new Date(), note,
  };

  /* Crossing into Sales: mint, and log the hand-over on BOTH records so each one's
     history reads whole on its own. */
  if (lead.track === 'inside_sales' && SALES_ROLES.includes(target.role)) {
    const qualified = [pipeline.IS_QUALIFIED_STAGE, pipeline.IS_HANDOFF_STAGE].includes(lead.isStage);
    const { lead: salesLead } = await salesEntry.mintSalesLead(lead, {
      stage: qualified ? 'prospect' : 'suspect',
      assignee: target._id,
      actor,
      reason: `was transferred from Inside Sales by ${actor.name || ROLE_LABELS[actor.role]}`,
      assigneeNote: note,
    });
    lead.transferHistory.push({ ...entry, note: note || `Transferred to Sales as ${salesLead.refId}` });
    await lead.save();
    /* The deal's opening entry says "created by actor, owned by target"; add the
       provenance so its page says where it came from without a join. */
    salesLead.transferHistory.push({
      ...entry, at: new Date(), /* after the deal's own 'created' entry, so the log reads in order */
      note: note || `Transferred from Inside Sales (${lead.refId})`,
    });
    await salesLead.save();

    await audit.record({
      action: 'record.update', entityType: 'lead', entityId: lead._id,
      summary: `${lead.refId} transferred to ${target.name} (${ROLE_LABELS[target.role]}) as ${salesLead.refId}`,
      meta: { from: entry.from ? String(entry.from) : null, to: String(target._id), note, salesLead: String(salesLead._id) },
    }, req);
    return { lead, salesLead, crossedTrack: true };
  }

  lead.owner = target._id;
  lead.directorManaged = false;
  lead.transferHistory.push(entry);
  await lead.save();

  await notifyAssignee(target._id, lead, note, {
    reason: `${actor.name || 'Your manager'} transferred it to you.`,
  });
  await audit.record({
    action: 'record.update', entityType: 'lead', entityId: lead._id,
    summary: `${lead.refId} ${entry.kind} to ${target.name}${previous ? ` from ${previous.name}` : ''}`,
    meta: { from: entry.from ? String(entry.from) : null, to: String(target._id), note },
  }, req);
  return { lead, salesLead: null, crossedTrack: false };
}

/* ── Escalation — brief §5, "Cannot transfer — escalates to ISM / ASM" ──────────── */

/**
 * An executive asks their manager to move a lead. One open request per lead: a second
 * one would give the manager two decisions about the same thing.
 */
async function requestTransfer(lead, requester, { reason = '', suggestedTo = null } = {}) {
  if (!reason.trim()) throw fail('Say why the lead should move', 'NO_REASON');
  if (String(lead.owner) !== String(requester._id)) throw fail('That lead is not yours', 'NOT_OWNER');

  const open = await Approval.findOne({
    kind: 'transfer', 'subject.id': lead._id, status: { $in: ['pending', 'escalated'] },
  }).lean();
  if (open) throw fail('A transfer request for this lead is already waiting', 'ALREADY_REQUESTED');

  return approvalService.request({
    kind: 'transfer',
    subject: { model: 'Lead', id: lead._id },
    payload: { reason: reason.trim(), suggestedTo: suggestedTo || null, refId: lead.refId, leadName: lead.name },
  }, requester);
}

/**
 * The manager decides. Approving IS the transfer — through transfer(), so the manager's
 * own matrix row still applies: an ASM approving an SE's request can only send the lead
 * to another SE in their area.
 */
async function decideRequest(approval, decider, { status, note = '', to = null, req } = {}) {
  if (!['approved', 'returned', 'rejected'].includes(status)) {
    throw fail('status must be one of: approved, returned, rejected', 'BAD_STATUS');
  }
  if (String(approval.assignedTo) !== String(decider._id)) throw fail('This request is not assigned to you', 'NOT_ASSIGNEE');
  if (approval.status !== 'pending' && approval.status !== 'escalated') {
    throw fail(`This request was already ${approval.status}`, 'ALREADY_DECIDED');
  }

  const lead = await Lead.findById(approval.subject.id);
  if (!lead) throw fail('The lead behind this request no longer exists', 'NO_LEAD');

  if (status !== 'approved') {
    await approvalService.decide(approval, decider, { status, note });
    return { approval, lead, result: null };
  }

  const target = to || approval.payload?.suggestedTo;
  if (!target) throw fail('Name who the lead goes to', 'NO_TARGET');
  const scope = await resolveScope(decider);
  const result = await transfer(lead, { to: target, actor: decider, scope, note, req });
  await approvalService.decide(approval, decider, { status: 'approved', note, decision: String(target) });
  return { approval, lead, result };
}

module.exports = {
  transfer, targetsFor, targetRolesFor, requestTransfer, decideRequest, notifyAssignee,
  IS_ROLES, SALES_ROLES,
};
