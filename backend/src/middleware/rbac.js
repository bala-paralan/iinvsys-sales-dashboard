'use strict';
const { forbidden } = require('../utils/response');

/* Role hierarchy: superadmin > manager > agent > referrer > readonly */
const ROLE_LEVEL = { superadmin: 4, manager: 3, agent: 2, referrer: 1, readonly: 1 };

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

module.exports = { requireRole, requireMinRole, scopeToAgent, allowReferrer };
