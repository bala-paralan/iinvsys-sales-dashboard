'use strict';

/**
 * permissions.js — explicit `resource.verb` permissions for the operational roles
 * introduced by the Business Process Framework.
 *
 * Mirrors docs/requirements/04-roles-and-permissions.md.
 *
 * WHY THIS EXISTS ALONGSIDE ROLE_LEVEL
 * ------------------------------------
 * `ROLE_LEVEL` in middleware/rbac.js is a total order (superadmin > manager > agent > ...).
 * The new roles are ORTHOGONAL to it — a delivery_manager is neither above nor below an
 * agent. But every pre-existing route and the whole test suite depend on requireMinRole,
 * so the ladder cannot be removed.
 *
 * The rule: every route added for Delivery / Installation / KPIs / Notifications uses
 * requirePermission(). Every pre-existing route keeps requireMinRole() untouched.
 *
 * All operational roles sit at ROLE_LEVEL 1 deliberately, so a warehouse user hitting
 * GET /api/leads (requireMinRole('agent')) is refused for free, with no new code.
 */

const PERMISSIONS = [
  /* Sales */
  'lead.read', 'lead.write', 'lead.advance', 'lead.gate_override', 'lead.delete',
  'deal.approve_deviation', 'po.verify',
  /* Delivery */
  'workorder.read', 'workorder.create', 'workorder.accept', 'workorder.commit_date',
  'workorder.advance', 'workorder.dispatch', 'workorder.deliver', 'workorder.upload',
  /* Installation & Customer Service */
  'install.read', 'install.assign', 'install.execute', 'install.advance',
  'install.handover', 'install.upload', 'support.manage',
  'feedback.log', 'feedback.corrective_action',
  /* Cross-cutting */
  'kpi.read', 'notification.read',
];

const ALL = PERMISSIONS.slice();

const ROLE_PERMISSIONS = {
  superadmin: ALL,

  manager: [
    'lead.read', 'lead.write', 'lead.advance', 'lead.gate_override', 'lead.delete',
    'po.verify',
    'workorder.read', 'workorder.create', 'workorder.accept', 'workorder.commit_date',
    'workorder.advance', 'workorder.dispatch', 'workorder.deliver', 'workorder.upload',
    'install.read', 'install.assign', 'install.execute', 'install.advance',
    'install.handover', 'install.upload', 'support.manage',
    'feedback.log', 'feedback.corrective_action',
    'kpi.read', 'notification.read',
  ],

  /* Framework: "final authority on deviations from standard terms and discounts". */
  sales_director: [
    'lead.read', 'lead.write', 'lead.advance', 'lead.gate_override',
    'deal.approve_deviation',
    'workorder.read', 'install.read', 'kpi.read', 'notification.read',
  ],

  /* Sales Executive / BDM. Scoped to their own book by scopeToAgent. */
  agent: [
    'lead.read', 'lead.write', 'lead.advance',
    'workorder.read', 'install.read', 'kpi.read', 'notification.read',
  ],

  /* Validation-only role: verifies the PO against agreed commercial terms. */
  finance: [
    'po.verify', 'workorder.read', 'notification.read',
  ],

  delivery_manager: [
    'workorder.read', 'workorder.create', 'workorder.accept', 'workorder.commit_date',
    'workorder.advance', 'workorder.dispatch', 'workorder.deliver', 'workorder.upload',
    'install.read', 'kpi.read', 'notification.read',
  ],

  warehouse: [
    'workorder.read', 'workorder.advance', 'workorder.upload', 'notification.read',
  ],

  /* Logistics Coordinator + Delivery Executive (assumption A23). */
  logistics: [
    'workorder.read', 'workorder.advance', 'workorder.dispatch', 'workorder.deliver',
    'workorder.upload', 'notification.read',
  ],

  installation_manager: [
    'workorder.read',
    'install.read', 'install.assign', 'install.execute', 'install.advance',
    'install.handover', 'install.upload', 'support.manage',
    'kpi.read', 'notification.read',
  ],

  technician: [
    'install.read', 'install.execute', 'install.advance', 'install.upload',
    'notification.read',
  ],

  cs_executive: [
    'workorder.read', 'install.read', 'install.upload', 'support.manage',
    'feedback.log', 'feedback.corrective_action', 'kpi.read', 'notification.read',
  ],

  /* Unchanged: referrers keep only their narrow expo lead-capture path. */
  referrer: [],
  readonly: [],
};

/** Roles introduced by the Business Process Framework. */
const OPERATIONAL_ROLES = [
  'sales_director', 'finance', 'delivery_manager', 'warehouse', 'logistics',
  'installation_manager', 'technician', 'cs_executive',
];

/** Every role the system recognises, in ladder order. */
const ALL_ROLES = [
  'superadmin', 'manager', 'sales_director', 'agent', 'finance',
  'delivery_manager', 'warehouse', 'logistics',
  'installation_manager', 'technician', 'cs_executive',
  'referrer', 'readonly',
];

/** Roles an admin may create through POST /api/auth/register. */
const REGISTERABLE_ROLES = ALL_ROLES.filter((r) => r !== 'referrer');

function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || [];
}

/** True when the role holds ANY of the listed permissions. */
function roleHasAny(role, perms) {
  const held = permissionsFor(role);
  return perms.some((p) => held.includes(p));
}

/** Roles that hold a given permission — used to address role-broadcast notifications. */
function rolesWith(permission) {
  return Object.keys(ROLE_PERMISSIONS).filter((r) => ROLE_PERMISSIONS[r].includes(permission));
}

module.exports = {
  PERMISSIONS, ROLE_PERMISSIONS, OPERATIONAL_ROLES, ALL_ROLES, REGISTERABLE_ROLES,
  permissionsFor, roleHasAny, rolesWith,
};
