'use strict';
const Approval = require('../models/Approval');
const CoachingNote = require('../models/CoachingNote');
const User = require('../models/User');
const { ok, created, notFound, paginated, badRequest, forbidden } = require('../utils/response');
const { parsePaging } = require('../utils/pagination');
const { scopeAllows } = require('../services/scopeService');
const approvalService = require('../services/approvalService');
const audit = require('../services/auditService');

/* ── GET /api/approvals ──────────────────────────────────────────── */

/* Two queues in one endpoint: `?queue=inbox` (waiting on me — the default, because that
   is what every approval screen in the spec renders) and `?queue=raised` (what I asked
   for). Neither is a general listing: an approval is only ever visible to the two people
   party to it, which is why there is no unfiltered branch here at all. */
async function listApprovals(req, res, next) {
  try {
    const { queue = 'inbox', kind, status } = req.query;
    const filter = queue === 'raised'
      ? { requestedBy: req.user._id }
      : { assignedTo: req.user._id };
    if (kind)   filter.kind   = kind;
    filter.status = status || 'pending';

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 50 });
    const [rows, total] = await Promise.all([
      Approval.find(filter)
        .populate('requestedBy', 'name role domain')
        .populate('assignedTo', 'name role')
        .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Approval.countDocuments(filter),
    ]);
    return paginated(res, rows, total, page, limit);
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/approvals/:id ──────────────────────────────────────── */

async function getApproval(req, res, next) {
  try {
    const row = await Approval.findById(req.params.id)
      .populate('requestedBy', 'name role domain')
      .populate('assignedTo', 'name role');
    if (!row) return notFound(res, 'Approval not found');
    if (!isParty(row, req.user)) return notFound(res, 'Approval not found');
    return ok(res, row);
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/approvals ─────────────────────────────────────────── */

async function requestApproval(req, res, next) {
  try {
    const { kind, subject, tier, payload, assignedTo } = req.body;
    if (!kind || !subject?.model || !subject?.id) {
      return badRequest(res, 'kind and subject{model,id} are required');
    }
    const approval = await approvalService.request(
      { kind, subject, tier, payload, assignedTo }, req.user,
    );
    return created(res, approval, 'Approval requested');
  } catch (err) {
    if (err.code === 'NO_APPROVER') return badRequest(res, err.message);
    next(err);
  }
}

/* ── POST /api/approvals/:id/decide ──────────────────────────────── */

async function decideApproval(req, res, next) {
  try {
    const { status, decision = '', note = '' } = req.body;
    if (!['approved', 'returned', 'rejected'].includes(status)) {
      return badRequest(res, "status must be one of: approved, returned, rejected");
    }

    const approval = await Approval.findById(req.params.id);
    if (!approval) return notFound(res, 'Approval not found');
    /* Only the person it is addressed to may decide it. Holding `approval.decide` says
       you are the KIND of person who approves things; it does not make someone else's
       queue yours. */
    if (String(approval.assignedTo) !== String(req.user._id)) {
      return forbidden(res, 'This approval is not assigned to you');
    }
    if (approval.status !== 'pending' && approval.status !== 'escalated') {
      return badRequest(res, `This approval was already ${approval.status}`);
    }

    await approvalService.decide(approval, req.user, { status, decision, note });
    await audit.record({
      action: 'record.update',
      entityType: 'approval',
      entityId: approval._id,
      summary: `${approval.kind.replace(/_/g, ' ')} approval ${status}`,
      meta: {
        subject: String(approval.subject.id), subjectModel: approval.subject.model,
        kind: approval.kind, status, decision,
      },
    }, req);
    return ok(res, approval, `Approval ${status}`);
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/approvals/:id/escalate ────────────────────────────── */

async function escalateApproval(req, res, next) {
  try {
    const approval = await Approval.findById(req.params.id);
    if (!approval) return notFound(res, 'Approval not found');
    if (String(approval.assignedTo) !== String(req.user._id)) {
      return forbidden(res, 'This approval is not assigned to you');
    }
    await approvalService.escalate(approval, req.user, { note: req.body.note || '' });
    return ok(res, approval, 'Approval escalated');
  } catch (err) {
    if (err.code === 'NO_ESCALATION_TARGET') return badRequest(res, err.message);
    next(err);
  }
}

function isParty(approval, user) {
  return String(approval.assignedTo?._id || approval.assignedTo) === String(user._id)
      || String(approval.requestedBy?._id || approval.requestedBy) === String(user._id);
}

/* ══════════════════════════════════════════════════════════════════
   Coaching notes — doc 1 IS-DIR-02, doc 2 SA-MGR-03
   ══════════════════════════════════════════════════════════════════ */

/**
 * Readable by the author and the author's ancestors; never by the subject, never by
 * peers. So a Director's note about an executive is invisible to that executive's own
 * IS Head — which is what "Private — not visible to Rajan or IS Head" means.
 */
function canReadCoaching(viewer, note, authorChain) {
  if (String(note.about?._id || note.about) === String(viewer._id)) return false;
  if (String(note.author?._id || note.author) === String(viewer._id)) return true;
  return (authorChain || []).some((id) => String(id) === String(viewer._id));
}

async function listCoachingNotes(req, res, next) {
  try {
    const { about } = req.query;
    if (!about) return badRequest(res, 'about (user id) is required');
    if (String(about) === String(req.user._id)) {
      /* Not a 403: telling someone a private note about them exists is most of the leak. */
      return ok(res, []);
    }
    if (!scopeAllows(req.scope, about)) return forbidden(res, 'That user is outside your team');

    const rows = await CoachingNote.find({ about })
      .populate('author', 'name role')
      .sort({ createdAt: -1 }).lean();

    const authors = await User.find({ _id: { $in: rows.map((r) => r.author?._id || r.author) } })
      .select('chain').lean();
    const chains = new Map(authors.map((a) => [String(a._id), a.chain || []]));

    return ok(res, rows.filter((n) => canReadCoaching(req.user, n, chains.get(String(n.author?._id || n.author)))));
  } catch (err) {
    next(err);
  }
}

async function createCoachingNote(req, res, next) {
  try {
    const { about, body, customer } = req.body;
    if (!about || !body) return badRequest(res, 'about and body are required');
    if (String(about) === String(req.user._id)) return badRequest(res, 'A coaching note is about someone else');
    if (!scopeAllows(req.scope, about)) return forbidden(res, 'That user is outside your team');

    const note = await CoachingNote.create({ about, body, customer: customer || null, author: req.user._id });
    return created(res, note, 'Coaching note saved');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listApprovals, getApproval, requestApproval, decideApproval, escalateApproval,
  listCoachingNotes, createCoachingNote, canReadCoaching,
};
