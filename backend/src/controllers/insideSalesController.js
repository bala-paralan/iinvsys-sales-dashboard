'use strict';
const { validationResult } = require('express-validator');
const Lead = require('../models/Lead');
const User = require('../models/User');
const Approval = require('../models/Approval');
const pipeline = require('../config/pipeline');
const { ok, created, notFound, badRequest, forbidden, unprocessable, paginated, gateFailed } = require('../utils/response');
const { parsePaging } = require('../utils/pagination');
const { scopeFilter, scopeAllows } = require('../services/scopeService');
const { applyTransition, previewGate } = require('../services/stageService');
const salesEntry = require('../services/salesEntryService');
const activityService = require('../services/activityService');
const approvalService = require('../services/approvalService');
const orgService = require('../services/orgService');
const notify = require('../services/notificationService');
const audit = require('../services/auditService');

/*
 * Inside Sales — ERP Bible V3 document 1.
 *
 * Records live in the Lead collection under `track:'inside_sales'` and run on
 * pipeline.IS_STAGES via the same stageService the other three processes use. Keeping
 * them here rather than in leadController is a readability decision, not a data one:
 * the endpoints are about qualification and routing, and leadController is already 850
 * lines about SPENCO.
 */

const IS_TRACK = { track: 'inside_sales' };

/* ── GET /api/is/leads ───────────────────────────────────────────── */

async function listLeads(req, res, next) {
  try {
    const { isStage, owner, priority, unassigned, q } = req.query;
    const filter = { ...IS_TRACK };

    Object.assign(filter, scopeFilter(req.scope, 'owner'));
    if (owner && scopeAllows(req.scope, owner)) filter.owner = owner;
    /* Doc 1 IS-DIR-01 and IS-HD-01 both headline "Unassigned — action needed". */
    if (unassigned === 'true') filter.owner = null;
    if (isStage)  filter.isStage  = isStage;
    if (priority) filter.priority = priority;
    if (q) filter.$or = [
      { name: new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { company: new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
    ];

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 100 });
    const [rows, total] = await Promise.all([
      Lead.find(filter)
        .populate('owner', 'name role initials color')
        .populate('customer', 'name city domain')
        .sort({ priority: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      Lead.countDocuments(filter),
    ]);
    return paginated(res, rows, total, page, limit);
  } catch (err) { next(err); }
}

/* ── GET /api/is/leads/:id ───────────────────────────────────────── */

async function getLead(req, res, next) {
  try {
    const lead = await loadIsLead(req.params.id);
    if (!lead) return notFound(res, 'Inside Sales lead not found');
    /* 404 rather than 403 on an out-of-scope id, so ids cannot be probed. */
    if (!scopeAllows(req.scope, lead.owner)) return notFound(res, 'Inside Sales lead not found');
    return ok(res, lead);
  } catch (err) { next(err); }
}

/* ── POST /api/is/leads ─ capture, and decide where it goes ──────── */

/*
 * Doc 1 IS-DIR-03, "the most important new screen in V3". One endpoint, three
 * destinations, because they are one decision the capturer makes once:
 *
 *   is_executive     nurture through BANT, then request a handoff
 *   bypass_is        a warm CXO lead enters SPENCO immediately — creates BOTH records
 *   director_managed stays in the Director's own queue rather than vanishing into a list
 */
async function createLead(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    const { assignmentMode = 'is_executive', assignTo, ...body } = req.body;
    const modes = pipeline.IS_ASSIGNMENT_MODES.map((m) => m.key);
    if (!modes.includes(assignmentMode)) {
      return badRequest(res, `assignmentMode must be one of: ${modes.join(', ')}`);
    }

    if (assignmentMode === 'director_managed') {
      /* Held personally. The Director IS the owner — not "unassigned", which is a
         different thing that IS-DIR-01 counts and chases separately. */
      return created(res, {
        lead: await newIsLead(body, req.user._id, req.user, { directorManaged: true }),
      }, 'Lead captured and held');
    }

    if (!assignTo) return badRequest(res, 'assignTo is required unless the lead is Director-managed');
    const assignee = await User.findById(assignTo).select('name role').lean();
    if (!assignee) return badRequest(res, 'assignTo does not name a user');

    if (assignmentMode === 'bypass_is') {
      if (assignee.role !== 'sales_executive' && assignee.role !== 'sales_manager') {
        return badRequest(res, 'Bypassing Inside Sales assigns to a Sales Executive or Manager');
      }
      /* Both records, deliberately: the Inside Sales one is closed as converted so the
         origin of the deal stays visible in Customer 360, which is the whole reason
         doc 1 draws the bypass as an arrow rather than a shortcut. */
      const isLead = await newIsLead(body, null, req.user, {
        isStage: pipeline.IS_QUALIFIED_STAGE,
      });
      const { lead: salesLead } = await salesEntry.mintSalesLead(isLead, {
        stage: req.body.spencoStage || 'prospect',
        assignee: assignTo,
        actor: req.user,
        reason: 'was routed straight to Sales by the Director (Inside Sales bypassed)',
      });
      return created(res, { lead: isLead, salesLead }, 'Lead captured and sent straight to Sales');
    }

    if (assignee.role !== 'is_executive' && assignee.role !== 'is_head') {
      return badRequest(res, 'Inside Sales leads are assigned to an IS Executive or the IS Head');
    }
    const lead = await newIsLead(body, assignTo, req.user);
    await notifyAssignee(assignTo, lead, req.body.note);
    return created(res, { lead }, 'Lead captured and assigned');
  } catch (err) {
    if (err.code === 'NO_ASSIGNEE' || err.code === 'UNKNOWN_STAGE') return badRequest(res, err.message);
    next(err);
  }
}

/* ── POST /api/is/leads/:id/assign ─ assign or reassign ──────────── */

async function assignLead(req, res, next) {
  try {
    const { assignTo, note = '' } = req.body;
    if (!assignTo) return badRequest(res, 'assignTo is required');

    const lead = await Lead.findOne({ _id: req.params.id, ...IS_TRACK });
    if (!lead) return notFound(res, 'Inside Sales lead not found');

    const assignee = await User.findById(assignTo).select('name role').lean();
    if (!assignee) return badRequest(res, 'assignTo does not name a user');
    /* An IS Head may only route within their own team — doc 1 IS-HD-02. The Director,
       whose scope is 'all', passes this for anyone. */
    if (!scopeAllows(req.scope, assignTo)) {
      return forbidden(res, 'That person is not in your team');
    }

    const previous = lead.owner;
    lead.owner = assignTo;
    lead.directorManaged = false;
    await lead.save();

    await notifyAssignee(assignTo, lead, note);
    await audit.record({
      action: 'record.update',
      entityType: 'lead',
      entityId: lead._id,
      summary: `${lead.refId} assigned to ${assignee.name}`,
      meta: { from: previous ? String(previous) : null, to: String(assignTo), note },
    }, req);

    return ok(res, lead, `Assigned to ${assignee.name}`);
  } catch (err) { next(err); }
}

/* ── PATCH /api/is/leads/:id/bant ────────────────────────────────── */

/*
 * Doc 1 IS-EX-05. Each dimension is confirmed independently and carries the note the
 * IS Head reads at IS-HD-04 — "Budget ₹80–120L confirmed" is a decision; a bare tick
 * is not.
 */
async function updateBant(req, res, next) {
  try {
    const lead = await Lead.findOne({ _id: req.params.id, ...IS_TRACK });
    if (!lead) return notFound(res, 'Inside Sales lead not found');
    if (!scopeAllows(req.scope, lead.owner)) return forbidden(res, 'That lead is not yours');

    const touched = [];
    for (const key of pipeline.BANT_KEYS) {
      const patch = req.body[key];
      if (!patch) continue;
      const dim = lead.bant[key];
      if (patch.note !== undefined) dim.note = patch.note;
      if (patch.confirmed !== undefined) {
        /* A confirmation with no note is the tick-box this screen exists to prevent. */
        if (patch.confirmed && !(patch.note || dim.note)) {
          return badRequest(res, `Record what was established before confirming ${key}`);
        }
        dim.confirmed = !!patch.confirmed;
        dim.confirmedAt = patch.confirmed ? new Date() : null;
        dim.confirmedBy = patch.confirmed ? req.user._id : null;
      }
      touched.push(key);
    }
    if (!touched.length) return badRequest(res, `Send at least one of: ${pipeline.BANT_KEYS.join(', ')}`);

    await lead.save();
    return ok(res, { bant: lead.bant, complete: bantComplete(lead) }, 'BANT updated');
  } catch (err) { next(err); }
}

/* ── POST /api/is/leads/:id/advance ──────────────────────────────── */

async function advanceLead(req, res, next) {
  try {
    const lead = await Lead.findOne({ _id: req.params.id, ...IS_TRACK });
    if (!lead) return notFound(res, 'Inside Sales lead not found');
    if (!scopeAllows(req.scope, lead.owner)) return forbidden(res, 'That lead is not yours');

    /* Conversion happens by approving the handoff, never by moving the stage. Without
       this, an executive could mark their own lead converted and no Sales record would
       exist behind it. */
    const to = req.body.toStage;
    if (to === pipeline.IS_CONVERTED_STAGE || to === pipeline.IS_HANDOFF_STAGE) {
      return badRequest(res, 'Use POST /api/is/leads/:id/request-handoff — this stage is not set by hand');
    }

    const result = applyTransition(lead, pipeline.IS_STAGES, {
      toStage: to,
      patch: req.body.patch,
      actor: req.user,
      stageField: 'isStage',
    });
    if (!result.ok) {
      return gateFailed(res, result.code, result.message, result.missing);
    }
    await lead.save();
    return ok(res, lead, `Moved to ${to.replace(/^is_/, '').replace(/_/g, ' ')}`);
  } catch (err) { next(err); }
}

/* ── GET /api/is/leads/:id/gate ──────────────────────────────────── */

async function previewLeadGate(req, res, next) {
  try {
    const lead = await Lead.findOne({ _id: req.params.id, ...IS_TRACK }).lean();
    if (!lead) return notFound(res, 'Inside Sales lead not found');
    if (!scopeAllows(req.scope, lead.owner)) return notFound(res, 'Inside Sales lead not found');
    return ok(res, previewGate(lead, pipeline.IS_STAGES, req.query.to, undefined, 'isStage'));
  } catch (err) { next(err); }
}

/* ── POST /api/is/leads/:id/request-handoff ──────────────────────── */

/*
 * Doc 1 IS-EX-05 → IS-HD-04. The request is an Approval addressed to the executive's own
 * manager, not a broadcast: an IS Head with four executives should not be told about
 * every other head's queue.
 */
async function requestHandoff(req, res, next) {
  try {
    const lead = await Lead.findOne({ _id: req.params.id, ...IS_TRACK });
    if (!lead) return notFound(res, 'Inside Sales lead not found');
    if (!scopeAllows(req.scope, lead.owner)) return forbidden(res, 'That lead is not yours');

    if (lead.convertedTo) return badRequest(res, 'This lead has already been converted');
    if (lead.handoffApproval) {
      const open = await Approval.findById(lead.handoffApproval).lean();
      if (open && open.status === 'pending') return ok(res, open, 'A handoff request is already open');
    }

    /* The BANT gate is judged here rather than trusted from the client, and the answer
       is the same checklist shape the stage gates return, so one component renders both. */
    const missing = pipeline.BANT_KEYS
      .filter((k) => !lead.bant[k] || !lead.bant[k].confirmed)
      .map((k) => ({ field: `bant.${k}`, message: `${k[0].toUpperCase()}${k.slice(1)} is not confirmed` }));
    if (missing.length) {
      return gateFailed(res, 'BANT_INCOMPLETE', 'BANT must be complete before a handoff', missing);
    }

    await salesEntry.attachCustomer(lead, req.user);

    const approval = await approvalService.request({
      kind: 'is_handoff',
      subject: { model: 'Lead', id: lead._id },
      payload: {
        refId: lead.refId, name: lead.name, company: lead.company,
        bant: lead.bant, note: req.body.note || '',
        suggestedAssignee: req.body.suggestedAssignee || null,
      },
    }, req.user);

    lead.handoffApproval = approval._id;
    lead.isStage = pipeline.IS_HANDOFF_STAGE;
    await lead.save();

    return created(res, approval, 'Handoff requested — waiting on the IS Head');
  } catch (err) {
    if (err.code === 'NO_APPROVER') {
      return badRequest(res, 'You have no IS Head to approve this. Ask an admin to set your reporting line.');
    }
    next(err);
  }
}

/* ── POST /api/is/handoffs/:id/decide ────────────────────────────── */

/*
 * Doc 1 IS-HD-04: approve → Sales, return for more qualification, or escalate to the
 * Director. Approving is the ONLY thing that mints a Sales lead, which is what makes
 * "no Sales record without an approved handoff" true rather than merely intended.
 */
async function decideHandoff(req, res, next) {
  try {
    const { status, note = '', assignTo } = req.body;
    if (!['approved', 'returned', 'rejected'].includes(status)) {
      return badRequest(res, 'status must be one of: approved, returned, rejected');
    }

    const approval = await Approval.findOne({ _id: req.params.id, kind: 'is_handoff' });
    if (!approval) return notFound(res, 'Handoff request not found');
    if (String(approval.assignedTo) !== String(req.user._id)) {
      return forbidden(res, 'This handoff is not assigned to you');
    }
    if (approval.status !== 'pending' && approval.status !== 'escalated') {
      return badRequest(res, `This handoff was already ${approval.status}`);
    }

    const lead = await Lead.findById(approval.subject.id);
    if (!lead) return notFound(res, 'The lead behind this handoff no longer exists');

    if (status !== 'approved') {
      await approvalService.decide(approval, req.user, { status, note });
      /* Back to the executive to finish the job — doc 1's "Return for More
         Qualification". The lead is workable again, not stuck at Handoff Requested. */
      lead.isStage = pipeline.IS_QUALIFIED_STAGE;
      lead.handoffApproval = null;
      await lead.save();
      return ok(res, { approval, lead }, `Handoff ${status}`);
    }

    const assignee = assignTo || approval.payload?.suggestedAssignee;
    if (!assignee) return badRequest(res, 'assignTo is required — name the Sales Executive who takes this');
    const target = await User.findById(assignee).select('role name').lean();
    if (!target || !['sales_executive', 'sales_manager'].includes(target.role)) {
      return badRequest(res, 'A handoff is assigned to a Sales Executive or Manager');
    }

    const { lead: salesLead } = await salesEntry.mintSalesLead(lead, {
      stage: 'prospect',
      assignee,
      actor: req.user,
      reason: 'was handed off from Inside Sales',
    });
    await approvalService.decide(approval, req.user, { status: 'approved', note });

    return ok(res, { approval, lead, salesLead }, `Handed off to ${target.name}`);
  } catch (err) {
    if (err.code === 'NO_ASSIGNEE') return badRequest(res, err.message);
    next(err);
  }
}

/* ── GET /api/is/team ─ exec performance, doc 1 IS-DIR-01 / IS-HD-01 ── */

async function teamPerformance(req, res, next) {
  try {
    /* The people BELOW the caller, never the caller. Doc 1 IS-HD-01 draws this as
       "Exec Performance — My Team": a list of the executives, with the Head's own numbers
       nowhere in it. `req.scope.userIds` deliberately includes self — it answers "whose
       rows may I read" — so a performance table has to drop it explicitly. */
    const ids = (req.scope.userIds === null
      ? (await User.find({ role: 'is_executive', isActive: true }).select('_id').lean()).map((u) => u._id)
      : req.scope.userIds
    ).filter((id) => String(id) !== String(req.user._id));

    const [rows, lastActivity, todayCounts] = await Promise.all([
      Lead.aggregate([
        { $match: { ...IS_TRACK, owner: { $in: ids } } },
        { $group: {
          _id: '$owner',
          assigned:  { $sum: 1 },
          contacted: { $sum: { $cond: [{ $in: ['$isStage', ['is_contacted', 'is_qualified', 'is_handoff_requested', 'is_converted']] }, 1, 0] } },
          qualified: { $sum: { $cond: [{ $in: ['$isStage', ['is_qualified', 'is_handoff_requested', 'is_converted']] }, 1, 0] } },
          lost:      { $sum: { $cond: [{ $eq: ['$isStage', 'is_lost'] }, 1, 0] } },
        } },
      ]),
      activityService.lastActivityFor(ids),
      /* Doc 1 IS-HD-01 shows "✓ 4 activities" / "⚠ 0 activities today" per executive —
         today's count, not the last timestamp. They answer different questions: one is
         "are they working now", the other "when did they last touch anything". */
      Promise.all(ids.map(async (id) => ({ id, n: await activityService.dailyCount(id) }))),
    ]);

    const users = await User.find({ _id: { $in: ids } })
      .select('name role initials color target').lean();
    const stats = new Map(rows.map((r) => [String(r._id), r]));
    const activity = new Map(lastActivity.map((a) => [String(a.user), a]));
    const today = new Map(todayCounts.map((t) => [String(t.id), t.n]));

    return ok(res, {
      execs: users.map((u) => {
        const s = stats.get(String(u._id)) || { assigned: 0, contacted: 0, qualified: 0, lost: 0 };
        return {
          user: u,
          ...s,
          /* Doc 1 IS-DIR-01 shows this column as a percentage of assigned. */
          qualificationRate: s.assigned ? Math.round((s.qualified / s.assigned) * 100) : null,
          /* The orange-at-24h / red-at-48h cell that "replaces the need for the Director
             to ask what did you do today". */
          lastActivity: activity.get(String(u._id)) || null,
          loggedToday: today.get(String(u._id)) || 0,
          /* Doc 1's "vs Target" column: qualifications against the executive's own
             monthly figure from the org chart. Null when nobody has set one — an
             invented denominator would make the column lie. */
          vsTarget: u.target ? Math.round((s.qualified / u.target) * 100) : null,
        };
      }),
      unassigned: await Lead.countDocuments({ ...IS_TRACK, owner: null }),
      handoffsPending: await Approval.countDocuments({ kind: 'is_handoff', status: 'pending' }),
      dailyActivityTarget: activityService.DAILY_ACTIVITY_TARGET,
    });
  } catch (err) { next(err); }
}

/* ── helpers ─────────────────────────────────────────────────────── */

async function newIsLead(body, owner, actor, extra = {}) {
  const lead = await Lead.create({
    ...body,
    track: 'inside_sales',
    refId: salesEntry.nextIsRefId(),
    isStage: 'is_new',
    stage: 'suspect',
    owner: owner || null,
    createdBy: actor._id,
    ...extra,
  });
  await salesEntry.attachCustomer(lead, actor);
  await lead.save();
  return lead;
}

async function notifyAssignee(userId, lead, note) {
  return notify.notifyUser(userId, {
    event: 'lead.assigned',
    severity: lead.priority === 'hot' ? 'critical' : 'warn',
    title: `New lead: ${lead.name}${lead.company ? ` — ${lead.company}` : ''}`,
    body: note || `${lead.refId} · priority ${lead.priority}`,
    reason: 'It was assigned to you.',
    entityType: 'lead',
    entityId: lead._id,
  });
}

function bantComplete(lead) {
  return pipeline.BANT_KEYS.every((k) => lead.bant[k] && lead.bant[k].confirmed);
}

function loadIsLead(id) {
  return Lead.findOne({ _id: id, ...IS_TRACK })
    .populate('owner', 'name role initials color')
    .populate('customer', 'name city domain contacts')
    .lean();
}

module.exports = {
  listLeads, getLead, createLead, assignLead, updateBant,
  advanceLead, previewLeadGate, requestHandoff, decideHandoff, teamPerformance,
};
