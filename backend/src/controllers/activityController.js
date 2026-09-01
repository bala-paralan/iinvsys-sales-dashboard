'use strict';
const { validationResult } = require('express-validator');
const Activity = require('../models/Activity');
const Task     = require('../models/Task');
const Customer = require('../models/Customer');
const { ok, created, notFound, unprocessable, paginated, badRequest, forbidden } = require('../utils/response');
const { parsePaging } = require('../utils/pagination');
const { scopeFilter, scopeAllows } = require('../services/scopeService');
const { can } = require('../middleware/rbac');
const activityService = require('../services/activityService');

/* ── GET /api/activities ─────────────────────────────────────────── */

async function listActivities(req, res, next) {
  try {
    const { customer, deal, by, type, from, to } = req.query;
    const filter = {};
    if (customer) filter.customer = customer;
    if (deal)     filter.deal     = deal;
    if (type)     filter.type     = type;
    if (from || to) {
      filter.occurredAt = {};
      if (from) filter.occurredAt.$gte = new Date(from);
      if (to)   filter.occurredAt.$lt  = new Date(to);
    }

    /*
     * Who may read whose log.
     *
     * `activity.read_team` is what separates a Manager from an Executive here: doc 2
     * SA-MGR-03 is the manager reading their exec's calls on one account, and doc 2
     * SA-EX-01 is an executive who must not see a peer's. A caller without it is pinned
     * to their own entries no matter what `?by=` says — which is the case that matters,
     * because `?by=` is trivially guessable.
     */
    if (can(req.user, 'activity.read_team')) {
      if (by) {
        if (!scopeAllows(req.scope, by)) return forbidden(res, 'That user is outside your team');
        filter.by = by;
      } else {
        Object.assign(filter, scopeFilter(req.scope, 'by'));
      }
    } else {
      filter.by = req.user._id;
    }

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 50 });
    const [rows, total] = await Promise.all([
      Activity.find(filter)
        .populate('by', 'name role initials color')
        .populate('customer', 'name city domain')
        .sort({ occurredAt: -1 }).skip(skip).limit(limit).lean(),
      Activity.countDocuments(filter),
    ]);
    return paginated(res, rows, total, page, limit);
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/activities ────────────────────────────────────────── */

async function createActivity(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    const customer = await Customer.findById(req.body.customer).select('_id').lean();
    if (!customer) return badRequest(res, 'customer must reference an existing customer');

    const { activity, task } = await activityService.logActivity(req.body, req.user);
    return created(res, { activity, task }, 'Activity logged');
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/activities/compliance ──────────────────────────────── */

/* Doc 1 IS-DIR-01: "Director sees when each exec last logged an activity ... 24h turns
   orange. 48h turns red. This replaces the need for the Director to ask 'what did you do
   today?'" Team-scoped, so an executive cannot use it as a peer leaderboard. */
async function compliance(req, res, next) {
  try {
    const ids = can(req.user, 'activity.read_team') && req.scope.userIds !== null
      ? req.scope.userIds
      : [req.user._id];

    const [lastActivity, today] = await Promise.all([
      activityService.lastActivityFor(ids),
      Promise.all(ids.map(async (id) => ({
        user: id,
        count: await activityService.dailyCount(id),
      }))),
    ]);

    const counts = new Map(today.map((t) => [String(t.user), t.count]));
    return ok(res, {
      dailyTarget: activityService.DAILY_ACTIVITY_TARGET,
      users: lastActivity.map((r) => ({
        ...r,
        loggedToday: counts.get(String(r.user)) || 0,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/tasks ──────────────────────────────────────────────── */

async function listTasks(req, res, next) {
  try {
    const { status, due, owner } = req.query;
    const filter = { status: status || 'open' };

    /* Same rule as activities: without team reach, you see your own list only. */
    if (can(req.user, 'activity.read_team')) {
      if (owner) {
        if (!scopeAllows(req.scope, owner)) return forbidden(res, 'That user is outside your team');
        filter.owner = owner;
      } else {
        Object.assign(filter, scopeFilter(req.scope, 'owner'));
      }
    } else {
      filter.owner = req.user._id;
    }

    if (due === 'today') {
      const end = new Date(); end.setHours(23, 59, 59, 999);
      filter.dueAt = { $lte: end };           // includes overdue — that is the point
    } else if (due === 'overdue') {
      filter.dueAt = { $lt: new Date() };
    }

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 50 });
    const [rows, total] = await Promise.all([
      Task.find(filter)
        .populate('customer', 'name city')
        .populate('deal', 'refId opportunityName stage')
        .sort({ dueAt: 1 }).skip(skip).limit(limit).lean(),
      Task.countDocuments(filter),
    ]);
    return paginated(res, rows, total, page, limit);
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/tasks ─────────────────────────────────────────────── */

async function createTask(req, res, next) {
  try {
    if (!req.body.title) return badRequest(res, 'title is required');
    if (!req.body.dueAt) return badRequest(res, 'dueAt is required');

    const task = await Task.create({
      ...req.body,
      owner: req.body.owner || req.user._id,
      source: 'manual',
      createdBy: req.user._id,
    });
    return created(res, task, 'Task created');
  } catch (err) {
    next(err);
  }
}

/* ── PATCH /api/tasks/:id ────────────────────────────────────────── */

async function updateTask(req, res, next) {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return notFound(res, 'Task not found');
    if (!scopeAllows(req.scope, task.owner)) return forbidden(res, 'That task is outside your team');

    if (req.body.status) {
      task.status = req.body.status;
      task.completedAt = req.body.status === 'done' ? new Date() : null;
    }
    if (req.body.dueAt) task.dueAt = req.body.dueAt;
    if (req.body.note !== undefined) task.note = req.body.note;
    await task.save();
    return ok(res, task, 'Task updated');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listActivities, createActivity, compliance,
  listTasks, createTask, updateTask,
};
