'use strict';
const { validationResult } = require('express-validator');
const { WON_STAGE, TERMINAL_SALES_STAGES } = require('../config/pipeline');
const { ALL_ROLES, REGISTERABLE_ROLES } = require('../config/permissions');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { ok, created, notFound, unprocessable, paginated, badRequest, forbidden, conflict } = require('../utils/response');
const { parsePaging } = require('../utils/pagination');
const { scopeAllows } = require('../services/scopeService');
const orgService = require('../services/orgService');
const activityService = require('../services/activityService');
const audit = require('../services/auditService');

/*
 * The staff directory and the org chart.
 *
 * This replaces v2's agentController. `Agent` was a second identity model that
 * `Lead.assignedAgent` pointed at while `User` held the login; the V3 org chart is a
 * graph of Users, so a resolver that returns User ids could not have filtered a column
 * of Agent ids. Folding the two also closes RELEASE_NOTES item P-1 — Installation
 * Planning requires a technician ObjectId and there was no endpoint that could supply one.
 */

const SAFE_FIELDS = 'name email role domain reportsTo initials phone territory designation target color joinDate isActive lastLogin createdAt';

/**
 * `.lean()` skips virtuals, so `status` — which the legacy client reads — never reaches
 * the wire from a lean query, and `initials` is absent on rows written straight through
 * the driver. Derive both here rather than dropping `.lean()` from a list endpoint.
 */
function present(u) {
  if (!u) return u;
  return {
    ...u,
    status: u.isActive === false ? 'inactive' : 'active',
    initials: u.initials || (u.name || '').trim().split(/\s+/).slice(0, 2)
      .map((w) => w[0]).join('').toUpperCase().slice(0, 3),
    color: u.color || 'var(--gold)',
  };
}

/* ── GET /api/users ──────────────────────────────────────────────── */

async function listUsers(req, res, next) {
  try {
    const { role, domain, territory, active, status, reportsTo, q } = req.query;
    const filter = {};
    if (role)      filter.role      = role;
    if (domain)    filter.domain    = domain;
    if (reportsTo) filter.reportsTo = reportsTo;
    if (territory) filter.territory = new RegExp(territory, 'i');
    if (active === 'true')  filter.isActive = true;
    if (active === 'false') filter.isActive = false;
    /* `?status=active|inactive` — the vocabulary the legacy client uses. */
    if (status === 'active')   filter.isActive = true;
    if (status === 'inactive') filter.isActive = false;
    if (q) filter.name = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    /* Referrers are external, temporary expo accounts, not staff. They are not part of
       the directory any internal screen renders. */
    filter.role = filter.role || { $ne: 'referrer' };

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 50 });
    const [users, total] = await Promise.all([
      User.find(filter).select(SAFE_FIELDS).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    return paginated(res, users.map(present), total, page, limit);
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/users/:id ──────────────────────────────────────────── */

async function getUser(req, res, next) {
  try {
    const user = await User.findById(req.params.id).select(SAFE_FIELDS).lean();
    if (!user) return notFound(res, 'User not found');
    return ok(res, present(user));
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/users/:id/reports ─ direct reports ─────────────────── */

async function getReports(req, res, next) {
  try {
    const user = await User.findById(req.params.id).select('_id').lean();
    if (!user) return notFound(res, 'User not found');
    return ok(res, await orgService.directReports(user._id));
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/users ─────────────────────────────────────────────── */

async function createUser(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    const { role } = req.body;
    if (role && !REGISTERABLE_ROLES.includes(role)) {
      return badRequest(res, `Role '${role}' cannot be created here`);
    }

    /* No password in the request: mint an unusable one, exactly as the referrer flow
       does. The account exists in the org chart and cannot be signed into until its
       holder sets a password through an invite. Requiring an admin to invent someone
       else's password is how shared credentials start. */
    const password = req.body.password
      || `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}A1!`;

    const user = await orgService.createUser({ ...req.body, password, createdBy: req.user._id });
    return created(res, sanitise(user), 'User created');
  } catch (err) {
    if (err.code === 'MANAGER_NOT_FOUND') return badRequest(res, err.message);
    if (err.code === 11000) return conflict(res, 'That email is already registered');
    next(err);
  }
}

/* ── PUT /api/users/:id ──────────────────────────────────────────── */

async function updateUser(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    /* `chain` is derived state maintained by orgService; `reportsTo` moves only through
       PATCH /:id/manager so the subtree repair can never be skipped. Accepting either
       here would let one careless PUT desynchronise every subtree query. */
    const { password, chain, reportsTo, ...safe } = req.body;
    /* `status` is a virtual over isActive; Mongoose does not apply setters through
       findByIdAndUpdate, so translate it here. */
    if (safe.status !== undefined) {
      if (!['active', 'inactive'].includes(safe.status)) {
        return badRequest(res, "status must be 'active' or 'inactive'");
      }
      safe.isActive = safe.status === 'active';
      delete safe.status;
    }

    const user = await User.findByIdAndUpdate(req.params.id, safe, {
      new: true, runValidators: true,
    }).select(SAFE_FIELDS);
    if (!user) return notFound(res, 'User not found');
    return ok(res, user, 'User updated');
  } catch (err) {
    next(err);
  }
}

/* ── PATCH /api/users/:id/manager ─ move a reporting line ────────── */

async function setManager(req, res, next) {
  try {
    const { reportsTo } = req.body;
    const user = await orgService.setManager(req.params.id, reportsTo || null);
    await audit.record({
      action: 'user.role_change',
      entityType: 'user',
      entityId: user._id,
      summary: `Reporting line changed for ${user.name || user._id}`,
      meta: {
        reportsTo: user.reportsTo ? String(user.reportsTo) : null,
        chain: (user.chain || []).map(String),
      },
    }, req);
    return ok(res, await User.findById(user._id).select(SAFE_FIELDS).lean(), 'Reporting line updated');
  } catch (err) {
    if (err.code === 'ORG_CYCLE') return badRequest(res, err.message);
    if (err.code === 'MANAGER_NOT_FOUND' || err.code === 'USER_NOT_FOUND') return notFound(res, err.message);
    next(err);
  }
}

/* ── DELETE /api/users/:id ─ soft deactivate ─────────────────────── */

async function deactivateUser(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return notFound(res, 'User not found');
    if (String(user._id) === String(req.user._id)) {
      return badRequest(res, 'You cannot deactivate your own account');
    }
    user.isActive = false;
    await user.save();
    return ok(res, {}, 'User deactivated');
  } catch (err) {
    next(err);
  }
}

/* ── DELETE /api/users/:id/hard ─ permanent removal ──────────────── */

async function hardDeleteUser(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return notFound(res, 'User not found');
    if (String(user._id) === String(req.user._id)) {
      return badRequest(res, 'You cannot delete your own account');
    }

    /* Anyone reporting to them would otherwise keep a chain through a user that no
       longer exists, and every subtree query beneath them would silently return nothing.
       Re-point them at this user's own manager before the record goes. */
    const reports = await User.find({ reportsTo: user._id }).select('_id').lean();
    for (const r of reports) await orgService.setManager(r._id, user.reportsTo || null);

    const orphaned = await Lead.updateMany({ owner: user._id }, { $set: { owner: null } });
    await User.findByIdAndDelete(user._id);

    await audit.destruction({
      entityType: 'user',
      entityId: user._id,
      label: user.name,
      reason: 'hard delete',
      snapshot: {
        name: user.name, email: user.email, role: user.role, domain: user.domain,
        reportsTo: user.reportsTo, territory: user.territory, target: user.target,
        leadsUnassigned: orphaned.modifiedCount,
        reportsReparented: reports.length,
      },
    }, req);

    return ok(res, { reportsReparented: reports.length }, 'User permanently deleted');
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/users/:id/stats ────────────────────────────────────── */

async function getUserStats(req, res, next) {
  try {
    const user = await User.findById(req.params.id).select(SAFE_FIELDS).lean();
    if (!user) return notFound(res, 'User not found');

    /* An executive may read their own numbers; a manager may read their team's. Without
       this, the peer comparison doc 1 and doc 2 both forbid is one URL away. */
    if (!scopeAllows(req.scope, user._id)) {
      return forbidden(res, 'That user is outside your team');
    }

    const [leads, stageBreakdown, activity] = await Promise.all([
      Lead.find({ owner: user._id }).select('stage value').lean(),
      Lead.aggregate([
        { $match: { owner: user._id } },
        { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$value' } } },
      ]),
      activityService.lastActivityFor([user._id]),
    ]);

    const wonLeads    = leads.filter((l) => l.stage === WON_STAGE);
    const activeLeads = leads.filter((l) => !TERMINAL_SALES_STAGES.includes(l.stage));
    const wonValue    = wonLeads.reduce((s, l) => s + (l.value || 0), 0);

    return ok(res, {
      user,
      summary: {
        totalLeads:  leads.length,
        activeLeads: activeLeads.length,
        wonLeads:    wonLeads.length,
        totalValue:  leads.reduce((s, l) => s + (l.value || 0), 0),
        wonValue,
        conversionRate: leads.length ? Math.round((wonLeads.length / leads.length) * 100) : 0,
        targetAchievement: user.target ? Math.round((wonValue / user.target) * 100) : 0,
      },
      stageBreakdown,
      activity: activity[0],
    });
  } catch (err) {
    next(err);
  }
}

function sanitise(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.password;
  delete obj.__v;
  return obj;
}

module.exports = {
  listUsers, getUser, getReports, createUser, updateUser, setManager,
  deactivateUser, hardDeleteUser, getUserStats, ALL_ROLES,
};
