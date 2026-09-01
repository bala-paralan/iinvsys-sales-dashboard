'use strict';
const { forbidden } = require('../utils/response');
const { roleHasAny, permissionsFor } = require('../config/permissions');

/*
 * ONE GATE: requirePermission().
 *
 * v2 ran two authorisation mechanisms side by side — a `ROLE_LEVEL` total order behind
 * `requireMinRole`, and this permission matrix. ERP Bible V3 names eleven roles that are
 * genuinely incomparable: a Production Head is neither above nor below an IS Head, and a
 * CS Agent is not a lesser Field Engineer. Ranking incomparable roles is what produced
 * the documented hole where every operational role sat at level 1 next to `readonly`,
 * and `requireMinRole('readonly')` — the guard on the staff directory, the priced
 * product catalogue and system settings — therefore admitted EVERY authenticated user,
 * including the external, bulk-generated referrer accounts.
 *
 * The ladder is gone. What replaces its one genuine virtue — that a route with no guard
 * still refused outsiders by accident — is `assertRoutesGuarded()` in src/app.js, which
 * refuses to BOOT if any authenticated route carries neither requirePermission nor
 * requireRole. Deny-by-default is now structural instead of incidental.
 *
 * See docs/requirements/04-roles-and-permissions.md
 */

/**
 * requireRole(...roles) — exact match, no ordering. Kept for the handful of routes that
 * are genuinely superadmin-only; it cannot produce a level collision because it compares
 * names, not ranks.
 */
function requireRole(...roles) {
  const guard = (req, res, next) => {
    if (!req.user) return forbidden(res, 'Not authenticated');
    if (!roles.includes(req.user.role)) {
      return forbidden(res, `Role '${req.user.role}' is not authorized for this action`);
    }
    next();
  };
  /* The marker goes on the MIDDLEWARE, not on this factory: assertRoutesGuarded walks
     Express's handler stack, which holds what the factory returned. */
  guard.isGuard = true;
  return guard;
}

/**
 * requirePermission(...perms) — allow when the caller's role holds ANY listed permission.
 * The only gate on every authenticated route that is not superadmin-only.
 */
function requirePermission(...perms) {
  const guard = (req, res, next) => {
    if (!req.user) return forbidden(res, 'Not authenticated');
    if (!roleHasAny(req.user.role, perms)) {
      return forbidden(res, `Role '${req.user.role}' lacks the required permission (${perms.join(' or ')})`);
    }
    next();
  };
  guard.isGuard = true;
  return guard;
}

/**
 * allowReferrer — referrers reach only their own expo's capture path.
 * Sets req.referrerExpoId so the controller can scope the response to that one expo.
 */
function allowReferrer(req, res, next) {
  if (req.user.role === 'referrer') {
    req.referrerExpoId = req.user.expoId;
    return next();
  }
  next();
}

/**
 * allowReferrerOr(...perms) — referrers pass through allowReferrer; everyone else must
 * hold one of the listed permissions.
 *
 * A controller behind this middleware MUST honour `req.referrerExpoId`. The referrer
 * branch deliberately grants no permission of its own: the expo id comes from the
 * account, never the query string, so the response cannot be widened.
 */
function allowReferrerOr(...perms) {
  const guard = (req, res, next) => {
    if (!req.user) return forbidden(res, 'Not authenticated');
    if (req.user.role === 'referrer') return allowReferrer(req, res, next);
    return requirePermission(...perms)(req, res, next);
  };
  guard.isGuard = true;
  return guard;
}

/** Convenience for controllers that branch on a permission rather than gate on it. */
function can(user, permission) {
  return !!user && permissionsFor(user.role).includes(permission);
}

module.exports = {
  requireRole, requirePermission, can,
  allowReferrer, allowReferrerOr,
};
