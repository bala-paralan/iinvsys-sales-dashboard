'use strict';
const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const User = require('../models/User');
const orgService = require('../services/orgService');
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
      /* The client's `Deal` type has always declared `customer: {_id, name} | null`, and
         the field was selected but never populated — so every screen that read a name off
         it (the account picker on Log Activity, the drill-down's per-account filter) got a
         bare id and silently found nothing. */
      .populate('customer', 'name city')
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

/* ── GET /api/deals/team ─ SA-DIR-01 / SA-DIR-02 / SA-MGR-01 / SA-MGR-09 ─── */

/* Doc 2 SA-DIR-01: "At Risk (>21d stale) — 5 — Needs intervention". */
const STALE_DAYS = 21;

/**
 * Per-person performance plus the roll-up SA-DIR-01 puts above it, scoped.
 *
 * `?user=` is SA-DIR-02, "Manager Drill-Down — select any manager, see their team": the
 * rows become that person's direct reports instead of the caller's. It is a NARROWING
 * only — the requested person must already be inside the caller's scope, so a Manager
 * cannot reach a peer's team by guessing an id.
 *
 * An executive holds no `kpi.read_team`, so cannot ask at all.
 */
async function teamPerformance(req, res, next) {
  try {
    /* The caller's team, not the caller. Doc 2 SA-MGR-01 keeps them apart on purpose:
       "My Executives" is one panel and "My Own Deals" is a separate one, so a manager's
       own pipeline never inflates their team's numbers. */
    let rootId = req.user._id;
    if (req.query.user) {
      if (!scopeAllows(req.scope, req.query.user)) {
        return forbidden(res, 'That person is outside your team');
      }
      rootId = req.query.user;
    }

    /*
     * `?rollup=1` — SPENCO CRM brief §6, the ZSM's "ASM-wise pipeline": one row per
     * DIRECT report, each row the sum of that person AND everyone beneath them. Without
     * it a ZSM's table is a flat list of ASMs and SEs, and an ASM's row shows only the
     * deals the ASM personally owns — the opposite of what "ASM-wise" means. The
     * Director gets the same view of their ZSMs.
     */
    const rollup = req.query.rollup === '1' || req.query.rollup === 'true';
    let headOf = null;       // owner id → the direct report whose row absorbs it
    let ids;
    if (rollup) {
      const heads = await User.find({ reportsTo: rootId, isActive: true }).select('_id').lean();
      headOf = new Map();
      for (const h of heads) {
        headOf.set(String(h._id), String(h._id));
        for (const d of await orgService.descendantIds(h._id)) headOf.set(String(d), String(h._id));
      }
      ids = [...headOf.keys()].map((k) => new mongoose.Types.ObjectId(k));
    } else {
      ids = (req.query.user
        /* SA-DIR-02: whoever reports to the person being drilled into. */
        ? (await User.find({ reportsTo: rootId, isActive: true }).select('_id').lean())
          .map((u) => u._id)
        : (req.scope.userIds === null
          ? (await User.find({ role: { $in: ['zonal_sales_manager', 'area_sales_manager', 'sales_executive'] }, isActive: true })
            .select('_id').lean()).map((u) => u._id)
          : req.scope.userIds)
      ).filter((id) => String(id) !== String(rootId));
    }

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
          /* Doc 2 SA-DIR-01's "At Risk" column: an OPEN deal nobody has touched in three
             weeks. A deal with no activity at all counts — that is the worse case, not
             the excluded one. */
          atRisk: { $sum: { $cond: [
            { $and: [
              { $in: ['$stage', pipeline.OPEN_SALES_STAGES] },
              { $or: [
                { $eq: [{ $ifNull: ['$lastActivityAt', null] }, null] },
                { $lt: ['$lastActivityAt', staleBefore()] },
              ] },
            ] }, 1, 0] } },
        } },
      ]),
      activityService.lastActivityFor(ids),
    ]);

    const rowIds = rollup ? [...new Set(headOf.values())].map((k) => new mongoose.Types.ObjectId(k)) : ids;
    const users = await User.find({ _id: { $in: rowIds } })
      .select('name role domain zone initials color target reportsTo').lean();

    /* SA-DIR-01 shows "2 execs" against each Manager row, and the Director's own table
       mixes Managers and Executives — so this is per-row rather than one figure. */
    const reportCounts = await User.aggregate([
      { $match: { reportsTo: { $in: users.map((u) => u._id) }, isActive: true } },
      { $group: { _id: '$reportsTo', n: { $sum: 1 } } },
    ]);
    const teamSizes = new Map(reportCounts.map((r) => [String(r._id), r.n]));

    /* SA-MGR-01's "Activities Today ✓ 3 logged today / ⚠ 1 logged today" column. */
    const todayCounts = await Promise.all(
      users.map(async (u) => [String(u._id), await activityService.dailyCount(u._id)]),
    );
    const today = new Map(todayCounts);

    const blank = { deals: 0, open: 0, won: 0, lost: 0, pipelineValue: 0, wonValue: 0, atRisk: 0 };
    const stats = new Map();
    const acts = new Map();
    for (const r of rows) {
      const key = rollup ? headOf.get(String(r._id)) : String(r._id);
      const acc = stats.get(key) || { ...blank };
      for (const f of Object.keys(blank)) acc[f] += r[f] || 0;
      stats.set(key, acc);
    }
    for (const a of activity) {
      const key = rollup ? headOf.get(String(a.user)) : String(a.user);
      const cur = acts.get(key);
      /* A subtree's last activity is its most recent member's. */
      if (!cur || (a.lastAt && (!cur.lastAt || new Date(a.lastAt) > new Date(cur.lastAt)))) acts.set(key, a);
    }
    if (rollup) {
      /* "Activities Today" for a subtree is the subtree's total, not the head's own. */
      const perHead = new Map();
      for (const [uid, head] of headOf) {
        if (uid === head) continue;
        perHead.set(head, (perHead.get(head) || 0) + await activityService.dailyCount(uid));
      }
      for (const [head, n] of perHead) today.set(head, (today.get(head) || 0) + n);
    }

    return ok(res, {
      people: users.map((u) => {
        const s = stats.get(String(u._id)) || blank;
        return {
          user: u,
          ...s,
          teamSize: teamSizes.get(String(u._id)) || 0,
          activitiesToday: today.get(String(u._id)) ?? 0,
          winRate: (s.won + s.lost) ? Math.round((s.won / (s.won + s.lost)) * 100) : null,
          targetAchieved: u.target ? Math.round((s.wonValue / u.target) * 100) : null,
          lastActivity: acts.get(String(u._id)) || null,
        };
      }),
      /* Only for the caller's OWN command view. `commandSummary` rolls up the caller's
         whole scope, which is the wrong denominator for someone else's team — better
         absent than quietly the reader's own number under a drilled-in heading. */
      summary: req.query.user ? null : await commandSummary(req),
    });
  } catch (err) { next(err); }
}

/** The cut-off `atRisk` is measured against — three weeks before now. */
function staleBefore() {
  return new Date(Date.now() - STALE_DAYS * 86400000);
}

/**
 * The five tiles across the top of SA-DIR-01, and the four across SA-MGR-01.
 *
 * Computed over the caller's WHOLE scope — including their own deals — because the tiles
 * answer "how is the function doing", which the person's own book is part of. The table
 * below them answers a different question and excludes the caller, which is the
 * distinction doc 2 draws between "Total Pipeline" and "My Executives".
 *
 * Money is `null`, not zero, for a caller without `finance.read`: redact.js would strip
 * the parts, so a total computed from them would be a figure nobody may see.
 */
async function commandSummary(req) {
  const filter = { ...SALES_TRACK, ...scopeFilter(req.scope, 'owner') };
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [open, own, closedMonth, wonLost, atRisk, pending] = await Promise.all([
    Lead.aggregate([
      { $match: { ...filter, stage: { $in: pipeline.OPEN_SALES_STAGES } } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: { $ifNull: ['$value', 0] } } } },
    ]),
    /* Doc 2 SA-MGR-01 draws "Team Pipeline ₹3.8Cr" and "My Own Deals ₹1.1Cr" as two
       tiles, because a manager carrying a large personal book and a team carrying nothing
       is a different situation from the reverse, and one combined figure hides which. */
    Lead.aggregate([
      { $match: { ...SALES_TRACK, owner: req.user._id, stage: { $in: pipeline.OPEN_SALES_STAGES } } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: { $ifNull: ['$value', 0] } } } },
    ]),
    Lead.aggregate([
      { $match: { ...filter, stage: pipeline.WON_STAGE, 'co.confirmedAt': { $gte: monthStart } } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: { $ifNull: ['$value', 0] } } } },
    ]),
    Lead.aggregate([
      { $match: { ...filter, stage: { $in: [pipeline.WON_STAGE, pipeline.LOST_STAGE] } } },
      { $group: { _id: '$stage', count: { $sum: 1 } } },
    ]),
    Lead.countDocuments({
      ...filter,
      stage: { $in: pipeline.OPEN_SALES_STAGES },
      $or: [{ lastActivityAt: null }, { lastActivityAt: { $lt: staleBefore() } }],
    }),
    Approval.countDocuments({
      assignedTo: req.user._id,
      status: { $in: ['pending', 'escalated'] },
      kind: { $in: ['discount', 'co_confirm'] },
    }),
  ]);

  const money = can(req.user, 'finance.read');
  const won = wonLost.find((r) => r._id === pipeline.WON_STAGE)?.count || 0;
  const lost = wonLost.find((r) => r._id === pipeline.LOST_STAGE)?.count || 0;

  return {
    openDeals: open[0]?.count || 0,
    pipelineValue: money ? (open[0]?.value || 0) : null,
    ownDeals: {
      count: own[0]?.count || 0,
      value: money ? (own[0]?.value || 0) : null,
    },
    closedThisMonth: {
      count: closedMonth[0]?.count || 0,
      value: money ? (closedMonth[0]?.value || 0) : null,
    },
    pendingApprovals: pending,
    atRisk,
    staleDays: STALE_DAYS,
    /* null, not 0%, when nothing has closed either way — an invented denominator makes
       the tile lie, the same reasoning as `targetAchieved`. */
    winRate: (won + lost) ? Math.round((won / (won + lost)) * 100) : null,
  };
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

/**
 * What the origination form may set, and nothing else.
 *
 * An ALLOWLIST rather than a rest-spread. `mintSalesLead` writes `seed` straight into the
 * document, so an unfiltered body let the creator post `discount: {percent: 40, status:
 * 'approved'}` or a pre-filled `spenco` block and walk past the ladder that
 * requestDiscount and the stage gates exist to enforce. Every field below is one doc 2
 * SA-DIR-04 or SA-EX-05 actually draws.
 */
const DEAL_SEED_FIELDS = [
  /* Contact & company — SA-DIR-04 "Contact & Company Information". */
  'name', 'phone', 'email', 'company', 'jobTitle', 'city', 'state',
  'companyType', 'industrySegment', 'zone', 'website',
  /* Routing and qualification. */
  'domain', 'source', 'productPackage', 'opportunityName',
  /* SA-DIR-04 "Est. Opportunity Size", "Priority", "Target First Contact Date" and
     "Director Intelligence / Context". */
  'value', 'priority', 'targetFirstContactAt', 'expectedCloseDate', 'notes',
];

/** Create a deal directly in SPENCO, through the one entry point. */
async function createDeal(req, res, next) {
  try {
    const { assignTo, stage = 'suspect', assigneeNote = '' } = req.body;
    if (!req.body.name || !req.body.phone) return badRequest(res, 'name and phone are required');

    const seed = {};
    for (const f of DEAL_SEED_FIELDS) {
      if (req.body[f] !== undefined && req.body[f] !== '') seed[f] = req.body[f];
    }

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
      seed,
      /* SA-DIR-04's "Director's Private Note to Assignee" — carried on the notification,
         not onto the deal, because it is addressed to one person. */
      assigneeNote,
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
