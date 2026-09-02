'use strict';
const Ticket = require('../models/Ticket');
const Contract = require('../models/Contract');
const InstallationJob = require('../models/InstallationJob');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Approval = require('../models/Approval');
const pipeline = require('../config/pipeline');
const { ok, created, notFound, badRequest, forbidden, paginated } = require('../utils/response');
const { parsePaging } = require('../utils/pagination');
const { scopeFilter, scopeAllows } = require('../services/scopeService');
const { can } = require('../middleware/rbac');
const supportService = require('../services/supportService');
const approvalService = require('../services/approvalService');
const audit = require('../services/auditService');

/*
 * Installation & Customer Support — ERP Bible V3 document 4.
 *
 * The rule that shapes this file, doc 4 IC-AG-01:
 *
 *   "CS Agents see only their own assigned tickets. They CANNOT see other agents'
 *    tickets, SLA performance comparisons, team statistics, or AMC contract values."
 *
 * Each clause is enforced somewhere different, and deliberately so: the tickets by
 * attachScope, the comparisons and statistics by `kpi.read_team`, and the contract values
 * by config/fieldVisibility.js at the response chokepoint.
 */

/* ── GET /api/tickets ─ IC-AG-01 / IC-CSM-02 ─────────────────────────────── */

async function listTickets(req, res, next) {
  try {
    const filter = {};
    /* An agent's scope is 'own'; the CS Manager's is 'all'. One filter, two screens. */
    Object.assign(filter, scopeFilter(req.scope, 'assignedTo'));
    if (req.query.assignedTo && scopeAllows(req.scope, req.query.assignedTo)) {
      filter.assignedTo = req.query.assignedTo;
    }
    if (req.query.unassigned === 'true' && req.scope.userIds === null) filter.assignedTo = null;
    if (req.query.status)   filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;
    if (req.query.customer) filter.customer = req.query.customer;
    if (req.query.breached === 'true') filter.slaBreached = true;
    if (req.query.open === 'true') filter.status = { $in: ['open', 'in_progress', 'awaiting_customer'] };

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 100 });
    const [rows, total] = await Promise.all([
      Ticket.find(filter)
        .populate('customer', 'name city')
        .populate('assignedTo', 'name initials color')
        .sort({ slaDueAt: 1 }).skip(skip).limit(limit).lean(),
      Ticket.countDocuments(filter),
    ]);
    return paginated(res, rows.map(withSla), total, page, limit);
  } catch (err) { next(err); }
}

/* ── GET /api/tickets/:id ────────────────────────────────────────────────── */

async function getTicket(req, res, next) {
  try {
    const t = await Ticket.findById(req.params.id)
      .populate('customer', 'name city contacts')
      .populate('assignedTo', 'name initials')
      .populate('activities.by', 'name')
      .lean();
    if (!t) return notFound(res, 'Ticket not found');
    /* 404 rather than 403 for another agent's ticket, so ids cannot be probed. */
    if (!scopeAllows(req.scope, t.assignedTo)) return notFound(res, 'Ticket not found');
    return ok(res, withSla(t));
  } catch (err) { next(err); }
}

/* ── POST /api/tickets ───────────────────────────────────────────────────── */

async function createTicket(req, res, next) {
  try {
    if (!req.body.customer) return badRequest(res, 'customer is required');
    if (!req.body.subject)  return badRequest(res, 'subject is required');
    const customer = await Customer.findById(req.body.customer).select('_id').lean();
    if (!customer) return badRequest(res, 'customer must reference an existing customer');

    /* An agent may raise a ticket, but only onto their own queue — assigning work to a
       colleague is the CS Manager's job. */
    let assignedTo = req.body.assignedTo || null;
    if (req.scope.mode === 'own') assignedTo = req.user._id;
    else if (assignedTo && !scopeAllows(req.scope, assignedTo)) {
      return forbidden(res, 'That agent is outside your team');
    }

    const ticket = await supportService.createTicket({ ...req.body, assignedTo }, req.user);
    return created(res, withSla(ticket.toObject()), `Ticket ${ticket.ref} raised`);
  } catch (err) { next(err); }
}

/* ── POST /api/tickets/:id/assign ─ IC-CSM-02 ────────────────────────────── */

async function assignTicket(req, res, next) {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return notFound(res, 'Ticket not found');

    const agent = await User.findById(req.body.assignedTo).select('name role').lean();
    if (!agent || agent.role !== 'cs_agent') {
      return badRequest(res, 'Tickets are assigned to a CS Agent');
    }
    ticket.assignedTo = agent._id;
    await ticket.save();
    return ok(res, withSla(ticket.toObject()), `Assigned to ${agent.name}`);
  } catch (err) { next(err); }
}

/* ── POST /api/tickets/:id/activities ─ IC-AG-02 ─────────────────────────── */

async function logActivity(req, res, next) {
  try {
    const { type, summary, minutes } = req.body;
    if (!type || !summary) return badRequest(res, 'type and summary are required');

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return notFound(res, 'Ticket not found');
    if (!scopeAllows(req.scope, ticket.assignedTo)) return forbidden(res, 'That ticket is not yours');

    await supportService.logTicketActivity(ticket, { type, summary, minutes }, req.user);
    return created(res, withSla(ticket.toObject()), 'Activity logged');
  } catch (err) { next(err); }
}

/* ── PATCH /api/tickets/:id ─ resolve / close ────────────────────────────── */

async function updateTicket(req, res, next) {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return notFound(res, 'Ticket not found');
    if (!scopeAllows(req.scope, ticket.assignedTo)) return forbidden(res, 'That ticket is not yours');

    const { status, resolution, priority } = req.body;
    if (priority) {
      if (!pipeline.TICKET_PRIORITY_KEYS.includes(priority)) return badRequest(res, 'Unknown priority');
      /* Re-deriving the SLA on an escalation is the model's job — see Ticket.pre. */
      ticket.priority = priority;
    }
    if (status && ['resolved', 'closed'].includes(status)) {
      if (status === 'resolved' && !(resolution || ticket.resolution)) {
        return badRequest(res, 'Say how it was resolved — the next agent to see this needs it');
      }
      await supportService.resolveTicket(ticket, { status, resolution }, req.user);
    } else {
      if (status) ticket.status = status;
      await ticket.save();
    }
    return ok(res, withSla(ticket.toObject()), 'Ticket updated');
  } catch (err) { next(err); }
}

/* ── GET /api/tickets/sla ─ IC-CSM-01 / IC-CSM-03 ────────────────────────── */

/**
 * Team SLA and per-agent comparison.
 *
 * Behind `kpi.read_team`, which a CS Agent does not hold. Doc 4 is explicit that agent
 * comparison is "exclusive to CS Manager" — an agent asking gets 403, not a filtered view,
 * because a filtered leaderboard of one is still a leaderboard.
 */
async function slaOverview(req, res, next) {
  try {
    const agentIds = req.scope.userIds === null
      ? (await User.find({ role: 'cs_agent', isActive: true }).select('_id').lean()).map((u) => u._id)
      : req.scope.userIds;

    const openFilter = { status: { $in: ['open', 'in_progress', 'awaiting_customer'] } };
    const [open, breached, agents, resolved] = await Promise.all([
      Ticket.countDocuments(openFilter),
      Ticket.countDocuments({ ...openFilter, slaBreached: true }),
      User.find({ _id: { $in: agentIds } }).select('name initials color').lean(),
      Ticket.find({ resolvedAt: { $ne: null } }).select('assignedTo raisedAt resolvedAt slaBreached').lean(),
    ]);

    const perAgent = await Ticket.aggregate([
      { $match: { assignedTo: { $in: agentIds } } },
      { $group: {
        _id: '$assignedTo',
        total: { $sum: 1 },
        open: { $sum: { $cond: [{ $in: ['$status', ['open', 'in_progress', 'awaiting_customer']] }, 1, 0] } },
        breached: { $sum: { $cond: ['$slaBreached', 1, 0] } },
      } },
    ]);
    const byAgent = new Map(perAgent.map((r) => [String(r._id), r]));

    const hours = (t) => (new Date(t.resolvedAt) - new Date(t.raisedAt)) / 36e5;
    const meanResolution = resolved.length
      ? Math.round((resolved.reduce((s, t) => s + hours(t), 0) / resolved.length) * 10) / 10
      : null;

    return ok(res, {
      open,
      breached,
      meanResolutionHours: meanResolution,
      agents: agents.map((a) => {
        const s = byAgent.get(String(a._id)) || { total: 0, open: 0, breached: 0 };
        const mine = resolved.filter((t) => String(t.assignedTo) === String(a._id));
        return {
          user: a,
          ...s,
          meanResolutionHours: mine.length
            ? Math.round((mine.reduce((x, t) => x + hours(t), 0) / mine.length) * 10) / 10
            : null,
        };
      }),
    });
  } catch (err) { next(err); }
}

/* ── Contracts — IC-CSM-04 / IC-AG-03 ────────────────────────────────────── */

async function listContracts(req, res, next) {
  try {
    const filter = {};
    if (req.query.customer) filter.customer = req.query.customer;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.expiringDays) {
      filter.expiresAt = { $lte: new Date(Date.now() + Number(req.query.expiringDays) * 86400000) };
    }

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 100 });
    const [rows, total] = await Promise.all([
      Contract.find(filter).populate('customer', 'name city')
        .sort({ expiresAt: 1 }).skip(skip).limit(limit).lean(),
      Contract.countDocuments(filter),
    ]);
    /* `value` and `renewalValue` are stripped for a CS Agent by utils/redact.js — this
       controller does not need to know, which is the point of the chokepoint. */
    return paginated(res, rows.map(withExpiry), total, page, limit);
  } catch (err) { next(err); }
}

async function renewalsDue(req, res, next) {
  try {
    const days = Number(req.query.days) || pipeline.CONTRACT_RENEWAL_WINDOW_DAYS;
    return ok(res, (await supportService.renewalsDue(days)).map(withExpiry));
  } catch (err) { next(err); }
}

/* ── POST /api/contracts/:id/push-to-sales ─ IC-CSM-04 ───────────────────── */

async function pushRenewal(req, res, next) {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return notFound(res, 'Contract not found');

    const result = await supportService.pushRenewalToSales(contract, req.user);
    return ok(res, {
      contract: withExpiry(contract.toObject()),
      lead: result.lead,
    }, result.created
      ? `Pushed to Sales as ${result.lead.refId} at Suspect`
      : 'Already pushed to Sales');
  } catch (err) {
    if (err.code === 'NO_ASSIGNEE') return badRequest(res, err.message);
    next(err);
  }
}

/* ── Sign-off — IC-FE-04 → IC-HD-04 ──────────────────────────────────────── */

/**
 * The Field Engineer captures the customer's signature and CSAT on site.
 *
 * Raising the approval here rather than letting the engineer close the job themselves is
 * doc 4's shape: the Head reviews the signature, the score and the completion report
 * before anything is created downstream.
 */
async function submitSignOff(req, res, next) {
  try {
    const job = await InstallationJob.findById(req.params.id);
    if (!job) return notFound(res, 'Installation job not found');
    if (!scopeAllows(req.scope, job.technician)) return forbidden(res, 'That job is not yours');

    const { signatoryName, signatoryTitle, csat, completionReport, signatureRef } = req.body;
    if (!signatoryName) return badRequest(res, 'The customer signatory must be named');
    if (!(csat >= 1 && csat <= pipeline.CSAT_MAX)) {
      return badRequest(res, `A CSAT score between 1 and ${pipeline.CSAT_MAX} is required`);
    }

    job.signOff.signatoryName = signatoryName;
    job.signOff.signatoryTitle = signatoryTitle || '';
    job.signOff.signatureRef = signatureRef || '';
    job.signOff.signedAt = new Date();
    job.signOff.csat = csat;
    job.signOff.completionReport = completionReport || '';
    job.signOff.collectedBy = req.user._id;

    const approval = await approvalService.request({
      kind: 'signoff',
      subject: { model: 'InstallationJob', id: job._id },
      payload: {
        jobNumber: job.jobNumber,
        company: job.customerSnapshot?.company,
        signatoryName, signatoryTitle: signatoryTitle || '',
        csat, completionReport: completionReport || '',
      },
    }, req.user);

    job.signOff.approval = approval._id;
    await job.save();
    return created(res, approval, 'Sign-off submitted for the Installation Head');
  } catch (err) {
    if (err.code === 'NO_APPROVER') {
      return badRequest(res, 'You have no Installation Head to approve this. Ask an admin to set your reporting line.');
    }
    next(err);
  }
}

/** The Head approves — and the AMC is created. */
async function decideSignOff(req, res, next) {
  try {
    const { status, note = '', months, value } = req.body;
    if (!['approved', 'returned'].includes(status)) {
      return badRequest(res, 'status must be approved or returned');
    }

    const approval = await Approval.findOne({ _id: req.params.id, kind: 'signoff' });
    if (!approval) return notFound(res, 'Sign-off not found');
    if (String(approval.assignedTo) !== String(req.user._id)) {
      return forbidden(res, 'This sign-off is not assigned to you');
    }
    if (!['pending', 'escalated'].includes(approval.status)) {
      return badRequest(res, `This sign-off was already ${approval.status}`);
    }

    const job = await InstallationJob.findById(approval.subject.id);
    if (!job) return notFound(res, 'The job behind this sign-off no longer exists');

    if (status === 'returned') {
      await approvalService.decide(approval, req.user, { status, note });
      job.signOff.approval = null;
      job.signOff.signedAt = null;
      await job.save();
      return ok(res, { approval, job }, 'Returned to the engineer');
    }

    const { contract } = await supportService.createContractForSignOff(job, req.user, { months, value });
    await approvalService.decide(approval, req.user, { status: 'approved', note });

    return ok(res, { approval, job, contract },
      `Sign-off approved — AMC ${contract.ref} created`);
  } catch (err) {
    if (err.code === 'NO_CUSTOMER') return badRequest(res, err.message);
    next(err);
  }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

/* Virtuals do not survive `.lean()`, and mongoose-lean-virtuals is not installed — the
   same trap that left wipPercent absent from every production read path in Phase 3. */
function withSla(t) {
  const due = t.slaDueAt ? new Date(t.slaDueAt).getTime() : null;
  return {
    ...t,
    slaRemainingMs: t.resolvedAt || !due ? null : due - Date.now(),
  };
}

function withExpiry(c) {
  return {
    ...c,
    daysToExpiry: c.expiresAt
      ? Math.ceil((new Date(c.expiresAt).getTime() - Date.now()) / 86400000)
      : null,
  };
}

module.exports = {
  listTickets, getTicket, createTicket, assignTicket, logActivity, updateTicket,
  slaOverview, listContracts, renewalsDue, pushRenewal,
  submitSignOff, decideSignOff,
};
