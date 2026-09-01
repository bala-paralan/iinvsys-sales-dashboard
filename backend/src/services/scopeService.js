'use strict';

/**
 * scopeService.js — row-level visibility, in one place.
 *
 * v2 had FOUR independent scoping mechanisms: `scopeToAgent` in the RBAC middleware, an
 * `agentScopeFilter` in workOrderController, an inline `role === 'technician'` test in
 * installationController, and a fourth inside excelReport's `scopeFor`. Replacing one of
 * them would have left three leaks, and the KPI endpoints had no scoping at all — every
 * role holding `kpi.read` received company-wide revenue, which is the exact thing
 * doc 2 forbids ("Sales Manager 1 cannot see that Sales Manager 2 is at only 44%").
 *
 * The contract is two functions, deliberately:
 *
 *   resolveScope(user) → the set of user ids this caller may see rows for
 *   scopeFilter(scope, field) → that set expressed against ONE named column
 *
 * They are separate because every model names its owner column differently — Lead.owner,
 * Activity.by, Task.owner, InstallationJob.technician, Ticket.assignedTo — so no single
 * filter object is universal. The resolver answers "who"; the caller says "in which
 * column", in one line.
 */

const { scopeModeFor, INSIDE_SALES_ONLY_ROLES } = require('../config/permissions');
const orgService = require('./orgService');

/**
 * @returns {{mode:'own'|'team'|'all', userIds: ObjectId[]|null, self: ObjectId,
 *            tracks: string[]|null}}
 *   `userIds` is null when mode === 'all' — meaning "no restriction", which is not the
 *   same as an empty array ("restricted to nobody"). Conflating the two is how a scope
 *   bug turns into a company-wide leak.
 *   `tracks` restricts which Lead tracks are visible, or null for no restriction.
 */
async function resolveScope(user) {
  const mode = scopeModeFor(user.role);
  const self = user._id;

  const tracks = INSIDE_SALES_ONLY_ROLES.includes(user.role) ? ['inside_sales'] : null;

  if (mode === 'all') return { mode, userIds: null, self, tracks };
  if (mode === 'own') return { mode, userIds: [self], self, tracks };

  const descendants = await orgService.descendantIds(self);
  return { mode, userIds: [self, ...descendants], self, tracks };
}

/** Express the scope against one named owner column. */
function scopeFilter(scope, field) {
  if (!scope || scope.userIds === null) return {};
  if (scope.userIds.length === 1) return { [field]: scope.userIds[0] };
  return { [field]: { $in: scope.userIds } };
}

/** True when the scope permits reading rows owned by `ownerId`. */
function scopeAllows(scope, ownerId) {
  if (!scope || scope.userIds === null) return true;
  if (!ownerId) return false;
  return scope.userIds.some((id) => String(id) === String(ownerId));
}

/** The Lead-track filter, if the role is confined to one track. */
function trackFilter(scope) {
  return scope && scope.tracks ? { track: { $in: scope.tracks } } : {};
}

module.exports = { resolveScope, scopeFilter, scopeAllows, trackFilter };
