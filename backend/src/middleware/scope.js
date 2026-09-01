'use strict';

const { resolveScope } = require('../services/scopeService');

/**
 * attachScope — resolves the caller's row-level visibility once per request and hangs it
 * on `req.scope`.
 *
 * Resolved once, not per query: a `team`-scoped caller costs one indexed `User.find` on
 * `{chain:1}`, and a controller that runs three queries should not pay for it three times.
 */
function attachScope(req, res, next) {
  if (!req.user) return next();
  resolveScope(req.user)
    .then((scope) => { req.scope = scope; next(); })
    .catch(next);
}

module.exports = { attachScope };
