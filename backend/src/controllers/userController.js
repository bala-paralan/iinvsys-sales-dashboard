'use strict';
const { validationResult } = require('express-validator');
const { WON_STAGE, TERMINAL_SALES_STAGES } = require('../config/pipeline');
const {
  ALL_ROLES, REGISTERABLE_ROLES, ROLE_LABELS, scopeModeFor, staffWriteMode,
} = require('../config/permissions');
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

const SAFE_FIELDS = 'name email role domain zone reportsTo initials phone territory designation target color joinDate isActive lastLogin createdAt';

/*
 * TEAM-SCOPED STAFF MANAGEMENT — SPENCO CRM brief §3, applied to all four modules.
 *
 * EVERY MANAGER STAFFS THEIR OWN TEAM. `user.write` says a caller may add and edit
 * staff; these rules say whose:
 *
 *   - a new person must report to the caller or to someone beneath them, so a manager
 *     can only grow their own team (and the chart rule then decides which ROLE that
 *     can be — an ASM's reports are SEs, full stop);
 *   - an existing person may be edited, moved or deactivated only if they are STRICTLY
 *     beneath the caller. A manager editing their own record through the staff form
 *     (role, target, active) is the one write the chart rule does not fully cover, so
 *     it is refused outright; that is what Account settings are for.
 *
 * THE DECIDING ROLE SET IS `staffWriteMode`, NOT `req.scope`. These checks used to read
 * `scope.userIds === null` — the READ scope — which made every role that reads
 * company-wide a company-wide staff administrator too. That is right for the superadmin
 * and the Director, and wrong for the three module heads: a Production Head reads every
 * engineer (doc 3) but may no more edit the Sales Director than an ASM may. Reading and
 * writing are separate axes; see STAFF_WRITE_ALL_ROLES in config/permissions.js.
 */
function writesAnywhere(req) { return staffWriteMode(req.user.role) === 'all'; }

/*
 * Where a scoped manager may PLACE someone: themselves, or anyone beneath them —
 * and the destination must be ACTIVE, because a deactivated person is not a post a new
 * hire can be filed under. Asks the org chart rather than `scope.userIds`, which for a
 * head whose read scope is 'all' is `null` and would wave every target through.
 */
async function managerInTeam(req, managerId) {
  if (String(managerId) === String(req.user._id)) return true;
  const mgr = await User.findById(managerId).select('isActive').lean();
  if (!mgr || mgr.isActive === false) return false;
  return orgService.isBeneath(req.user._id, managerId);
}

/*
 * `scope.userIds` counts ACTIVE descendants only — right for leads, wrong here: a
 * manager who deactivates someone would lose the ability to see, edit or restore them
 * the moment they did it. These two ask the org chart directly instead, so a
 * deactivated person stays administrable by the manager they report to.
 */
async function beneath(req, id) {
  if (writesAnywhere(req)) return true;
  return orgService.isBeneath(req.user._id, id);
}
async function staffIds(req) {
  const descendants = await orgService.descendantIds(req.user._id, { includeInactive: true });
  return [req.user._id, ...descendants];
}

/*
 * Two guards that apply to every staff write, whatever the caller's reach.
 *
 * `protectsSuperadmin` — nobody but a superadmin writes to a superadmin's record. The
 * Director's staff reach is company-wide so that they can build the org chart, and that
 * included the platform account: `PUT {role:'sales_executive'}` or one DELETE on
 * admin@iinvsys.com locked every administrator out of a deployment whose only
 * superadmin it is, with no route back through the app.
 *
 * `grantsCompanyWideRole` — a scoped manager may not appoint a role that reads the whole
 * company (Director, Production Head, Installation Head, CS Manager). The chart rule in
 * REPORTS_TO_ROLES already refuses these placements; this says the same thing in terms
 * of privilege rather than chart shape, so neither layer is the only thing standing
 * between a team manager and a company-wide reader.
 */
function protectsSuperadmin(req, target) {
  return target && target.role === 'superadmin' && req.user.role !== 'superadmin';
}
function grantsCompanyWideRole(req, role) {
  return !!role && !writesAnywhere(req) && scopeModeFor(role) === 'all';
}

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
    const { role, domain, zone, territory, active, status, reportsTo, q } = req.query;
    const filter = {};
    if (role)      filter.role      = role;
    if (domain)    filter.domain    = domain;
    if (zone)      filter.zone      = zone;
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
    /* `?team=1` — only the caller's own subtree (self included). The staff screen asks
       for this so a manager sees the people they may actually edit; the plain directory
       stays company-wide because every assignee picker reads it. */
    if (req.query.team === '1' || req.query.team === 'true') {
      if (!writesAnywhere(req)) filter._id = { $in: await staffIds(req) };
      /* Deactivated people are part of staff administration — they are how Restore is
         reached. `?active=` still narrows explicitly when a caller wants only one. */
    }

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
    /* A manager grows their own team and nothing else. Nobody but a superadmin mints
       another superadmin, whatever their scope. */
    if (!writesAnywhere(req)) {
      if (!req.body.reportsTo) return badRequest(res, 'New people must report to you or to someone in your team');
      if (!await managerInTeam(req, req.body.reportsTo)) return forbidden(res, 'That manager is not in your team');
    }
    if (role === 'superadmin' && req.user.role !== 'superadmin') {
      return forbidden(res, 'Only a superadmin can create a superadmin');
    }
    if (grantsCompanyWideRole(req, role)) {
      return forbidden(res, `Only the Director can appoint a ${ROLE_LABELS[role] || role}`);
    }

    /* No password in the request: mint an unusable one, exactly as the referrer flow
       does. The account exists in the org chart and cannot be signed into until its
       holder sets a password through an invite. Requiring an admin to invent someone
       else's password is how shared credentials start. */
    const password = req.body.password
      || `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}A1!`;

    const user = await orgService.createUser({ ...req.body, password, createdBy: req.user._id });
    await audit.record({
      action: 'user.create',
      entityType: 'user',
      entityId: user._id,
      summary: `${user.name} added as ${ROLE_LABELS[user.role] || user.role}`,
      meta: { role: user.role, reportsTo: user.reportsTo ? String(user.reportsTo) : null },
    }, req);
    return created(res, sanitise(user), 'User created');
  } catch (err) {
    if (err.code === 'MANAGER_NOT_FOUND' || err.code === 'ORG_INVALID_MANAGER') return badRequest(res, err.message);
    if (err.code === 11000) return conflict(res, 'That email is already registered');
    next(err);
  }
}

/* ── PUT /api/users/:id ──────────────────────────────────────────── */

async function updateUser(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    const target = await User.findById(req.params.id).select('role name isActive').lean();
    if (!target) return notFound(res, 'User not found');
    if (protectsSuperadmin(req, target)) {
      return forbidden(res, 'Only a superadmin can change a superadmin account');
    }
    if (!await beneath(req, req.params.id)) return forbidden(res, 'That person is not in your team');
    if (req.body.role === 'superadmin' && req.user.role !== 'superadmin') {
      return forbidden(res, 'Only a superadmin can grant superadmin');
    }
    if (grantsCompanyWideRole(req, req.body.role)) {
      return forbidden(res, `Only the Director can appoint a ${ROLE_LABELS[req.body.role] || req.body.role}`);
    }

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

    /* A role change must leave the chart in the brief's shape — see orgService. */
    if (safe.role) {
      try { await orgService.assertRoleFitsChart(req.params.id, safe.role); }
      catch (err) {
        if (err.code === 'ORG_INVALID_MANAGER') return badRequest(res, err.message);
        if (err.code === 'USER_NOT_FOUND') return notFound(res, err.message);
        throw err;
      }
    }

    const user = await User.findByIdAndUpdate(req.params.id, safe, {
      new: true, runValidators: true,
    }).select(SAFE_FIELDS);
    if (!user) return notFound(res, 'User not found');
    /* A staff edit is an access change as often as it is a profile change — a role, a
       target, or the isActive flag that Restore flips. Logged with the field names so
       "who reactivated this account" is answerable; values stay out, since one of them
       could be an email address being corrected. */
    const restored = safe.isActive === true && target.isActive === false;
    await audit.record({
      action: 'record.update',
      entityType: 'user',
      entityId: user._id,
      summary: restored
        ? `${user.name} restored`
        : `${user.name} updated (${Object.keys(safe).join(', ')})`,
      meta: { fields: Object.keys(safe), role: user.role },
    }, req);
    return ok(res, user, 'User updated');
  } catch (err) {
    next(err);
  }
}

/* ── PATCH /api/users/:id/manager ─ move a reporting line ────────── */

async function setManager(req, res, next) {
  try {
    const { reportsTo } = req.body;
    /* Both ends of the move stay inside the caller's team: the person, and where they
       land. A manager unplacing someone (reportsTo: null) would push them out of every
       team's view, so that too is the Director's call. */
    const moving = await User.findById(req.params.id).select('role').lean();
    if (!moving) return notFound(res, 'User not found');
    if (protectsSuperadmin(req, moving)) {
      return forbidden(res, 'Only a superadmin can change a superadmin account');
    }
    if (!await beneath(req, req.params.id)) return forbidden(res, 'That person is not in your team');
    if (!writesAnywhere(req) && (!reportsTo || !await managerInTeam(req, reportsTo))) {
      return forbidden(res, 'People in your team must report to you or to someone in your team');
    }
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
    if (err.code === 'ORG_CYCLE' || err.code === 'ORG_INVALID_MANAGER') return badRequest(res, err.message);
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
    if (protectsSuperadmin(req, user)) {
      return forbidden(res, 'Only a superadmin can deactivate a superadmin account');
    }
    if (!await beneath(req, user._id)) return forbidden(res, 'That person is not in your team');
    user.isActive = false;
    await user.save();
    /* Deactivation revokes every session and every login (middleware/auth.js and
       authController both refuse an inactive account), so it is the system's real
       "delete" for a person. It was the one staff write with no audit row at all. */
    await audit.record({
      action: 'record.delete',
      entityType: 'user',
      entityId: user._id,
      summary: `${user.name} deactivated`,
      meta: { role: user.role, soft: true },
    }, req);
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
    for (const r of reports) {
      try {
        await orgService.setManager(r._id, user.reportsTo || null);
      } catch (err) {
        /* The grandparent is the wrong role for them (an SE cannot report to a ZSM).
           Leave them unplaced rather than refuse the delete; the Director sees them. */
        if (err.code !== 'ORG_INVALID_MANAGER') throw err;
        await orgService.setManager(r._id, null);
      }
    }

    const orphaned = await Lead.updateMany({ owner: user._id }, { $set: { owner: null } });
    await User.findByIdAndDelete(user._id);

    await audit.destruction({
      entityType: 'user',
      entityId: user._id,
      label: user.name,
      reason: 'hard delete',
      snapshot: {
        name: user.name, email: user.email, role: user.role, domain: user.domain, zone: user.zone,
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
