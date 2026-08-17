'use strict';
const { forbidden } = require('../utils/response');
const { roleHasAny, permissionsFor } = require('../config/permissions');

/*
 * Role hierarchy: superadmin > manager/sales_director > agent > readonly > outsiders.
 *
 * The ladder answers exactly one question: "how far into internal sales data may
 * this account see?" It is NOT a seniority ranking.
 *
 * LEVEL 1 IS `readonly` AND NOTHING ELSE. `readonly` is the internal view-only
 * role, and `requireMinRole('readonly')` is the guard on the agent directory,
 * the product catalogue, the expo list and system settings — i.e. it means
 * "any internal viewer".
 *
 * LEVEL 0 is everyone with no business reading internal sales data:
 *
 *   - `referrer` — an external, temporary expo-capture account. Its credentials
 *     are generated in bulk and handed out at events. It must never be able to
 *     enumerate staff, prices or settings. Referrers reach the one expo they are
 *     attached to through allowReferrerOr(), which scopes the response.
 *
 *   - the operational roles (delivery_manager, warehouse, logistics,
 *     installation_manager, technician, cs_executive, finance). These are
 *     orthogonal to the ladder — a warehouse operator is not "below" a sales
 *     agent, they simply have no business in the sales pipeline. They reach
 *     everything they need through requirePermission() on the Delivery /
 *     Installation / KPI routes.
 *
 * These were all previously at level 1, which — because `readonly` is also 1 and
 * the test is `>=` — meant requireMinRole('readonly') admitted EVERY
 * authenticated user, referrers included. Regression: tests/10-role-ladder.test.js.
 *
 * See docs/requirements/04-roles-and-permissions.md
 */
const ROLE_LEVEL = {
  superadmin: 4,
  manager: 3,
  sales_director: 3,
  agent: 2,
  readonly: 1,
  /* level 0 — no internal read */
  finance: 0,
  delivery_manager: 0,
  warehouse: 0,
  logistics: 0,
  installation_manager: 0,
  technician: 0,
  cs_executive: 0,
  referrer: 0,
};

/**
 * requireRole(...roles) — allow only listed roles
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return forbidden(res, 'Not authenticated');
    if (!roles.includes(req.user.role)) {
      return forbidden(res, `Role '${req.user.role}' is not authorized for this action`);
    }
    next();
  };
}

/**
 * requireMinRole(role) — allow role and above in hierarchy
 */
function requireMinRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return forbidden(res, 'Not authenticated');
    if ((ROLE_LEVEL[req.user.role] || 0) < (ROLE_LEVEL[minRole] || 0)) {
      return forbidden(res, `Minimum role '${minRole}' required`);
    }
    next();
  };
}

/**
 * scopeToAgent — agents can only access their own leads.
 * Attaches agentId filter to req.agentScope for controller use.
 */
function scopeToAgent(req, res, next) {
  if (req.user.role === 'agent') {
    req.agentScope = req.user.agentId;
    if (!req.agentScope) return forbidden(res, 'Agent profile not linked to this account');
  } else {
    req.agentScope = null; // admin/manager sees all
  }
  next();
}

/**
 * allowReferrer — extends agent-level routes to also accept referrer role.
 * Referrers can only POST leads (not list/update/delete).
 * Sets req.referrerExpoId so the controller can auto-tag the expo.
 */
function allowReferrer(req, res, next) {
  if (req.user.role === 'referrer') {
    req.agentScope = null;
    req.referrerExpoId = req.user.expoId;
    return next();
  }
  next();
}

/**
 * allowReferrerOr(minRole) — referrers pass through allowReferrer (which sets
 * req.referrerExpoId so the controller can scope the response); everyone else
 * must clear `minRole` and is then agent-scoped as usual.
 *
 * This is the pattern `routes/leads.js` already used inline. It is a named
 * export so that a route needing referrer access cannot accidentally reach for
 * `requireMinRole('readonly')` instead and expose the whole collection.
 *
 * A controller behind this middleware MUST honour `req.referrerExpoId`.
 */
function allowReferrerOr(minRole) {
  return (req, res, next) => {
    if (!req.user) return forbidden(res, 'Not authenticated');
    if (req.user.role === 'referrer') return allowReferrer(req, res, next);
    return requireMinRole(minRole)(req, res, () => scopeToAgent(req, res, next));
  };
}

/**
 * requirePermission(...perms) — allow when the caller's role holds ANY listed permission.
 *
 * Used by every route added for Delivery, Installation, KPIs and Notifications.
 * Pre-existing routes keep requireMinRole untouched so the ~716 existing tests
 * and their role expectations stay valid.
 */
function requirePermission(...perms) {
  return (req, res, next) => {
    if (!req.user) return forbidden(res, 'Not authenticated');
    if (!roleHasAny(req.user.role, perms)) {
      return forbidden(res, `Role '${req.user.role}' lacks the required permission (${perms.join(' or ')})`);
    }
    next();
  };
}

/** Convenience for controllers that branch on a permission rather than gate on it. */
function can(user, permission) {
  return !!user && permissionsFor(user.role).includes(permission);
}

module.exports = {
  requireRole, requireMinRole, requirePermission, can,
  scopeToAgent, allowReferrer, allowReferrerOr, ROLE_LEVEL,
};
