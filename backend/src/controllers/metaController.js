'use strict';

const pipeline = require('../config/pipeline');
const { ROLE_PERMISSIONS, permissionsFor, scopeModeFor } = require('../config/permissions');
const { portalFor } = require('../config/portals');
const { can } = require('../middleware/rbac');
const orgService = require('../services/orgService');
const User = require('../models/User');
const { ok } = require('../utils/response');

/**
 * GET /api/meta/pipeline
 *
 * The browser's single source for stage keys, labels, colours, enums and gate
 * definitions. Every role needs the labels, so this is `authenticate` only.
 *
 * app.js caches the payload in localStorage keyed by `version`, which is derived
 * from the stage keys themselves — renaming a stage invalidates every client
 * cache without anyone remembering to bump a number.
 */
function getPipeline(req, res) {
  const meta = pipeline.serialize();
  /*
   * `me` DELIBERATELY DOES NOT LIVE HERE ANY MORE — see GET /api/meta/me.
   *
   * usePipeline.ts caches this payload with `staleTime: Infinity`, keyed on `version`.
   * While the per-user block rode along inside it, changing someone's role or portal
   * changed what this endpoint sent and changed nothing about what an already-signed-in
   * client believed — indefinitely. `Cache-Control: no-store` fixes the HTTP cache; it
   * does nothing about TanStack Query's in-memory copy.
   *
   * `version` now also hashes the role list and every stage's ownerRole, so a taxonomy
   * change does invalidate the half that is genuinely cacheable.
   */
  /* NOT cacheable by the HTTP layer. This payload embeds `me.role` and
     `me.permissions`, but the browser caches by URL and does NOT include the
     Authorization header in the cache key — so `private, max-age=300` served
     one user's permissions to the NEXT user to sign in on the same machine,
     for five minutes. On a shared expo laptop that is the normal case, not an
     edge case. (The API still enforces authorisation server-side, so this
     mis-rendered the UI rather than granting access — but it showed people
     capabilities they did not have and hid ones they did.)

     Nothing is lost: the client caches this payload itself, keyed by the
     `version` hash, which is a better invalidation signal than a timer. */
  res.set('Cache-Control', 'no-store');
  res.set('Vary', 'Authorization');
  return ok(res, meta, 'Pipeline metadata');
}

/**
 * GET /api/meta/me
 *
 * Everything about the caller: permissions, row-level scope, portal, and the direct
 * reports that render every "Switch Exec ▼" picker and assignment dropdown in the
 * specification without a second round trip.
 *
 * Its own endpoint, and never cached, precisely because it is the part that changes
 * without the pipeline changing.
 */
async function getMe(req, res, next) {
  try {
    const [reportsTo, directReports] = await Promise.all([
      req.user.reportsTo
        ? User.findById(req.user.reportsTo).select('name role').lean()
        : null,
      orgService.directReports(req.user._id),
    ]);

    res.set('Cache-Control', 'no-store');
    res.set('Vary', 'Authorization');
    return ok(res, {
      userId: req.user._id,
      name: req.user.name,
      role: req.user.role,
      domain: req.user.domain,
      permissions: permissionsFor(req.user.role),
      scope: {
        mode: scopeModeFor(req.user.role),
        /* Named explicitly so a screen can hide a money column rather than render an
           empty one. The server still strips the values either way — see utils/redact.js;
           this is a rendering hint, never the enforcement. */
        canSeeFinancials: can(req.user, 'finance.read'),
      },
      reportsTo: reportsTo ? { id: reportsTo._id, name: reportsTo.name, role: reportsTo.role } : null,
      directReports,
      portal: portalFor(req.user.role),
    }, 'Session metadata');
  } catch (err) { return next(err); }
}

/**
 * GET /api/meta/permissions
 * The full role → permission matrix. Manager+ only — it is an authorisation map,
 * not something an agent needs.
 */
function getPermissions(req, res) {
  return ok(res, { roles: ROLE_PERMISSIONS }, 'Permission matrix');
}

module.exports = { getPipeline, getMe, getPermissions };
