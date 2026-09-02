'use strict';
const Lead = require('../models/Lead');
const User = require('../models/User');
const Approval = require('../models/Approval');
const pipeline = require('../config/pipeline');
const { ok, created, notFound, badRequest, forbidden, paginated } = require('../utils/response');
const { parsePaging } = require('../utils/pagination');
const { scopeFilter, scopeAllows } = require('../services/scopeService');
const { can } = require('../middleware/rbac');
const dealService = require('../services/dealService');
const salesEntry = require('../services/salesEntryService');
const activityService = require('../services/activityService');
const notify = require('../services/notificationService');

/*
 * Sales — ERP Bible V3 document 2.
 *
 * The SPENCO pipeline itself is leadController's: the stages, the gates and the advance
 * endpoint predate V3 and are unchanged. What lives here is what doc 2 adds on top —
 * the discount ladder, the Commercial Order sign-off, and the three scope levels of the
 * same board that SA-DIR-05, SA-MGR-05 and SA-EX-02 draw.
 */

const SALES_TRACK = { track: 'sales' };

/* ── GET /api/deals/board ─ SA-DIR-05 / SA-MGR-05 / SA-EX-02 ─────────────── */

/**
 * One endpoint, three screens. The Director's all-team board, the Manager's team board
 * and the Executive's personal board differ only by which rows the SERVER returns, so
 * there is one definition of "what is in Negotiation" rather than three.
 */
async function board(req, res, next) {
  try {
    const filter = { ...SALES_TRACK, ...scopeFilter(req.scope, 'owner') };
    if (req.query.owner && scopeAllows(req.scope, req.query.owner)) filter.owner = req.query.owner;
    if (req.query.domain) {
      /* Doc 2 SA-DIR-01's manager tabs. A filter, never a boundary — the rows were
         already narrowed by scope before this line. */
      const team = await User.find({ domain: req.query.domain }).select('_id').lean();
      const ids = team.map((u) => u._id);
      filter.owner = filter.owner
        ? (ids.some((i) => String(i) === String(filter.owner)) ? filter.owner : null)
        : { $in: ids };
    }

    const rows = await Lead.find(filter)
      .select('refId name company stage value probability owner customer expectedCloseDate '
            + 'discount lastActivityAt stageEnteredAt spenco co')
      .populate('owner', 'name initials color domain')
      .sort({ stageEnteredAt: -1 })
      .lean();

    const stages = pipeline.SALES_STAGES.map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      deals: rows.filter((r) => r.stage === s.key),
      /* `value` is redacted for a finance-blind caller by utils/redact.js, so summing it
         here would produce a total the same caller is not allowed to see the parts of.
         Only compute it for someone who holds finance.read. */
      value: can(req.user, 'finance.read')
        ? rows.filter((r) => r.stage === s.key).reduce((sum, r) => sum + (r.value || 0), 0)
        : null,
    }));

    return ok(res, { stages, total: rows.length });
  } catch (err) { next(err); }
}

/* ── GET /api/deals/team ─ SA-DIR-01 / SA-MGR-09 ─────────────────────────── */

/** Per-person performance, scoped. An executive holds no kpi.read_team, so cannot ask. */
async function teamPerformance(req, res, next) {
  try {
    /* The caller's team, not the caller. Doc 2 SA-MGR-01 keeps them apart on purpose:
       "My Executives" is one panel and "My Own Deals" is a separate one, so a manager's
       own pipeline never inflates their team's numbers. */
    const ids = (req.scope.userIds === null
      ? (await User.find({ role: { $in: ['sales_manager', 'sales_executive'] }, isActive: true })
        .select('_id').lean()).map((u) => u._id)
      : req.scope.userIds
    ).filter((id) => String(id) !== String(req.user._id));

    const [rows, activity] = await Promise.all([
      Lead.aggregate([
        { $match: { ...SALES_TRACK, owner: { $in: ids } } },
        { $group: {
          _id: '$owner',
          deals: { $sum: 1 },
          open: { $sum: { $cond: [{ $in: ['$stage', pipeline.OPEN_SALES_STAGES] }, 1, 0] } },
          won: { $sum: { $cond: [{ $eq: ['$stage', pipeline.WON_STAGE] }, 1, 0] } },
          lost: { $sum: { $cond: [{ $eq: ['$stage', pipeline.LOST_STAGE] }, 1, 0] } },
          pipelineValue: { $sum: { $cond: [{ $in: ['$stage', pipeline.OPEN_SALES_STAGES] }, { $ifNull: ['$value', 0] }, 0] } },
          wonValue: { $sum: { $cond: [{ $eq: ['$stage', pipeline.WON_STAGE] }, { $ifNull: ['$value', 0] }, 0] } },
        } },
      ]),
      activityService.lastActivityFor(ids),
    ]);

    const users = await User.find({ _id: { $in: ids } })
      .select('name role domain initials color target reportsTo').lean();
    const stats = new Map(rows.map((r) => [String(r._id), r]));
    const acts = new Map(activity.map((a) => [String(a.user), a]));

    return ok(res, {
      people: users.map((u) => {
        const s = stats.get(String(u._id))
          || { deals: 0, open: 0, won: 0, lost: 0, pipelineValue: 0, wonValue: 0 };
        return {
          user: u,
          ...s,
          winRate: (s.won + s.lost) ? Math.round((s.won / (s.won + s.lost)) * 100) : null,
          targetAchieved: u.target ? Math.round((s.wonValue / u.target) * 100) : null,
          lastActivity: acts.get(String(u._id)) || null,
        };
      }),
    });
  } catch (err) { next(err); }
}

/* ── GET /api/deals/forecast ─ SA-DIR-08 ─────────────────────────────────── */

async function forecast(req, res, next) {
  try {
    const filter = { ...SALES_TRACK, ...scopeFilter(req.scope, 'owner') };
    const open = await Lead.find({ ...filter, stage: { $in: pipeline.OPEN_SALES_STAGES } })
      .select('value probability stage expectedCloseDate').lean();

    const byStage = pipeline.SALES_STAGES
      .filter((s) => !s.terminal)
      .map((s) => {
        const deals = open.filter((d) => d.stage === s.key);
        return {
          stage: s.key,
          label: s.label,
          count: deals.length,
          value: deals.reduce((t, d) => t + (d.value || 0), 0),
          /* Weighted by the stage's own probability where the deal has none of its own —
             the same number the KPI service uses, so the forecast and the dashboard
             cannot disagree. */
          weighted: deals.reduce(
            (t, d) => t + (d.value || 0) * ((d.probability ?? s.probability ?? 0) / 100), 0),
        };
      });

    const won = await Lead.aggregate([
      { $match: { ...filter, stage: pipeline.WON_STAGE } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: { $ifNull: ['$value', 0] } } } },
    ]);

    return ok(res, {
      byStage,
      openTotal: byStage.reduce((t, s) => t + s.value, 0),
      weightedTotal: Math.round(byStage.reduce((t, s) => t + s.weighted, 0)),
      won: won[0] ? { count: won[0].count, value: won[0].value } : { count: 0, value: 0 },
    });
  } catch (err) { next(err); }
}

/* ── POST /api/deals ─ SA-DIR-04 / SA-EX-05 ──────────────────────────────── */

/** Create a deal directly in SPENCO, through the one entry point. */
async function createDeal(req, res, next) {
  try {
    const { assignTo, stage = 'suspect', ...body } = req.body;
    if (!body.name || !body.phone) return badRequest(res, 'name and phone are required');

    /* An own-scoped executive creates their own deals; anyone with wider scope must say
       whose it is, so a Director cannot create an unowned deal by omission. */
    const owner = req.scope.mode === 'own' ? req.user._id : assignTo;
    if (!owner) return badRequest(res, 'assignTo is required');
    if (!scopeAllows(req.scope, owner)) return forbidden(res, 'That person is not in your team');

    const { lead } = await salesEntry.mintSalesLead(null, {
      stage,
      assignee: owner,
      actor: req.user,
      reason: 'was created directly in the Sales pipeline',
      seed: body,
    });
    await salesEntry.attachCustomer(lead, req.user);
    await lead.save();

    return created(res, lead, 'Deal created');
  } catch (err) {
    if (err.code === 'NO_ASSIGNEE' || err.code === 'UNKNOWN_STAGE') return badRequest(res, err.message);
    next(err);
  }
}

/* ── POST /api/deals/:id/discount ─ SA-EX-06 ─────────────────────────────── */

async function requestDiscount(req, res, next) {
  try {
    const { percent, justification, standardPrice } = req.body;
    if (percent === undefined) return badRequest(res, 'percent is required');

    const lead = await loadDeal(req, res);
    if (!lead) return undefined;
    if (!scopeAllows(req.scope, lead.owner)) return forbidden(res, 'That deal is not yours');

    const result = await dealService.requestDiscount(
      lead, { percent, justification, standardPrice }, req.user,
    );

    return ok(res, {
      discount: result.lead.discount,
      value: result.lead.value,
      approval: result.approval,
      approver: result.approver ? { name: result.approver.name, role: result.approver.role } : null,
      /* Surfaced rather than hidden: a request that went to someone outside the
         requester's own reporting line is worth the approver knowing about. */
      routedByFallback: !!result.approver?.viaFallback,
    }, result.selfApproved
      ? `${percent}% is within your own authority — applied`
      : `Sent to ${result.approver.name} for approval`);
  } catch (err) {
    if (['BAD_DISCOUNT', 'NO_APPROVER'].includes(err.code)) return badRequest(res, err.message);
    next(err);
  }
}

/* ── POST /api/deals/discounts/:id/decide ─ SA-MGR-08 / SA-DIR-07 ────────── */

async function decideDiscount(req, res, next) {
  try {
    const { status, counterPercent, note = '' } = req.body;
    if (!['approved', 'returned', 'rejected'].includes(status)) {
      return badRequest(res, 'status must be one of: approved, returned, rejected');
    }

    const approval = await Approval.findOne({ _id: req.params.id, kind: 'discount' });
    if (!approval) return notFound(res, 'Discount request not found');
    if (String(approval.assignedTo) !== String(req.user._id)) {
      return forbidden(res, 'This request is not assigned to you');
    }
    if (!['pending', 'escalated'].includes(approval.status)) {
      return badRequest(res, `This request was already ${approval.status}`);
    }

    const result = await dealService.decideDiscount(approval, req.user, { status, counterPercent, note });
    return ok(res, {
      approval: result.approval,
      discount: result.lead.discount,
      value: result.lead.value,
    }, `Discount ${status}`);
  } catch (err) {
    if (['ABOVE_AUTHORITY', 'NO_SUBJECT'].includes(err.code)) return badRequest(res, err.message);
    next(err);
  }
}

/* ── POST /api/deals/:id/proposal ─ SA-EX-06 ─────────────────────────────── */

async function recordProposal(req, res, next) {
  try {
    const lead = await loadDeal(req, res);
    if (!lead) return undefined;
    if (!scopeAllows(req.scope, lead.owner)) return forbidden(res, 'That deal is not yours');

    lead.proposal.version = (lead.proposal.version || 0) + 1;
    lead.proposal.sentAt = new Date();
    lead.proposal.sentBy = req.user._id;
    lead.proposal.note = req.body.note || '';
    await lead.save();

    return ok(res, lead.proposal, `Proposal v${lead.proposal.version} recorded`);
  } catch (err) { next(err); }
}

/* ── POST /api/deals/:id/commercial-order ─ SA-EX-07 ─────────────────────── */

async function submitCommercialOrder(req, res, next) {
  try {
    const lead = await loadDeal(req, res);
    if (!lead) return undefined;
    if (!scopeAllows(req.scope, lead.owner)) return forbidden(res, 'That deal is not yours');

    const result = await dealService.submitCommercialOrder(
      lead, { poValue: req.body.poValue, note: req.body.note }, req.user,
    );
    return created(res, result.approval,
      result.created ? 'Commercial Order submitted for confirmation' : 'Already submitted');
  } catch (err) {
    if (['ALREADY_CONFIRMED', 'NO_APPROVER', 'GATE_NOT_PASSED'].includes(err.code)) return badRequest(res, err.message);
    next(err);
  }
}

/* ── POST /api/deals/commercial-orders/:id/confirm ─ SA-DIR-09 ───────────── */

async function confirmCommercialOrder(req, res, next) {
  try {
    const approval = await Approval.findOne({ _id: req.params.id, kind: 'co_confirm' });
    if (!approval) return notFound(res, 'Commercial Order not found');
    if (String(approval.assignedTo) !== String(req.user._id)) {
      return forbidden(res, 'This order is not assigned to you');
    }
    if (!['pending', 'escalated'].includes(approval.status)) {
      return badRequest(res, `This order was already ${approval.status}`);
    }

    const result = await dealService.confirmCommercialOrder(
      approval, req.user, { note: req.body.note }, req,
    );
    return ok(res, {
      lead: result.lead,
      workOrder: result.workOrder,
    }, result.workOrder
      ? `Confirmed — production order ${result.workOrder.woNumber} raised`
      : 'Confirmed');
  } catch (err) {
    if (err.code === 'NO_SUBJECT') return badRequest(res, err.message);
    next(err);
  }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

async function loadDeal(req, res) {
  const lead = await Lead.findOne({ _id: req.params.id, ...SALES_TRACK });
  if (!lead) { notFound(res, 'Deal not found'); return null; }
  return lead;
}

module.exports = {
  board, teamPerformance, forecast, createDeal,
  requestDiscount, decideDiscount, recordProposal,
  submitCommercialOrder, confirmCommercialOrder,
};
