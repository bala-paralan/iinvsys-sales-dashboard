'use strict';

const pipeline = require('../config/pipeline');
const { ROLE_PERMISSIONS, permissionsFor } = require('../config/permissions');
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
  meta.me = {
    role: req.user.role,
    permissions: permissionsFor(req.user.role),
  };
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
 * GET /api/meta/permissions
 * The full role → permission matrix. Manager+ only — it is an authorisation map,
 * not something an agent needs.
 */
function getPermissions(req, res) {
  return ok(res, { roles: ROLE_PERMISSIONS }, 'Permission matrix');
}

module.exports = { getPipeline, getPermissions };
