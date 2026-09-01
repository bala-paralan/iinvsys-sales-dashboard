'use strict';

/**
 * permissions.js — the role taxonomy and permission matrix.
 *
 * Mirrors docs/requirements/04-roles-and-permissions.md.
 *
 * ONE AUTHORISATION MECHANISM
 * ---------------------------
 * Earlier revisions ran two: a `ROLE_LEVEL` total order (requireMinRole) alongside this
 * matrix. ERP Bible V3 names eleven roles that are genuinely incomparable — a Production
 * Head is neither above nor below an IS Head — and ranking incomparable roles is exactly
 * what produced the documented hole where `requireMinRole('readonly')` admitted every
 * authenticated user, referrers included.
 *
 * The ladder is gone. `requirePermission()` is the only gate, plus `requireRole()` for
 * exact-match superadmin routes and `allowReferrer` for the expo capture path. A boot-time
 * assertion in src/app.js refuses to start if any authenticated route carries neither.
 *
 * WHY ONLY THESE PERMISSIONS EXIST
 * --------------------------------
 * Every string below is referenced by at least one route or config, enforced by
 * tests/30-permission-coverage.test.js. `deal.approve_deviation`, `po.verify` and
 * `workorder.create` were declared in v2 and wired to nothing for a whole release; they
 * return in the phase that actually uses them, not before.
 */

const PERMISSIONS = [
  /* Identity, org chart and platform configuration */
  'user.read', 'user.write', 'user.assign_reports', 'directory.read',
  'catalog.read', 'catalog.write', 'settings.read', 'settings.write', 'expo.manage',
  /* Customers and the per-customer interaction log */
  'customer.read', 'customer.write', 'customer.merge',
  'activity.read', 'activity.write', 'activity.read_team',
  'task.read', 'task.write',
  'coaching.read', 'coaching.write',
  /* Approvals — one queue model, five kinds */
  'approval.request', 'approval.decide', 'approval.escalate',
  /* Sales */
  'lead.read', 'lead.write', 'lead.advance', 'lead.gate_override', 'lead.delete',
  /* Delivery / Production */
  'workorder.read', 'workorder.accept', 'workorder.commit_date',
  'workorder.advance', 'workorder.dispatch', 'workorder.deliver', 'workorder.upload',
  /* Installation & Customer Service */
  'install.read', 'install.assign', 'install.execute', 'install.advance',
  'install.handover', 'install.upload', 'support.manage',
  'feedback.log', 'feedback.corrective_action',
  /* Cross-cutting */
  'kpi.read', 'kpi.read_team', 'kpi.read_company', 'report.export',
  'notification.read', 'finance.read',
];

const ALL = PERMISSIONS.slice();

/*
 * V3 roles. The four Sales Managers are ONE role differentiated by `User.domain` and
 * reporting line; likewise the eight Sales Executives. Modelling them as separate roles
 * would put four identical columns in this table and make the org chart un-editable
 * without a code change.
 */
const ROLE_PERMISSIONS = {
  superadmin: ALL,

  /* Doc 1 + Doc 2: sees everything, creates and assigns anywhere, final approval authority. */
  sales_director: [
    /* Doc 1 IS-DIR-03 and doc 2 SA-DIR-04 both list "Director Origination — Trade Show /
       Expo" as a lead source, so the Director runs the expo capture programme. */
    'user.read', 'directory.read', 'catalog.read', 'settings.read', 'expo.manage',
    'customer.read', 'customer.write', 'customer.merge',
    'activity.read', 'activity.write', 'activity.read_team',
    'task.read', 'task.write', 'coaching.read', 'coaching.write',
    'approval.request', 'approval.decide', 'approval.escalate',
    'lead.read', 'lead.write', 'lead.advance', 'lead.gate_override', 'lead.delete',
    'workorder.read', 'install.read',
    'kpi.read', 'kpi.read_team', 'kpi.read_company', 'report.export',
    'notification.read', 'finance.read',
  ],

  /*
   * Doc 1: "Sees all IS Execs under them ... Cannot see Sales pipeline."
   * The Sales-pipeline denial is a SCOPE rule, not a permission one — is_head holds
   * lead.read but scopeService restricts it to track:'inside_sales'. Permissions answer
   * "which verbs"; the scope resolver answers "over which rows".
   */
  is_head: [
    'user.read', 'directory.read', 'catalog.read',
    'customer.read', 'customer.write',
    'activity.read', 'activity.write', 'activity.read_team',
    'task.read', 'task.write', 'coaching.read', 'coaching.write',
    'approval.request', 'approval.decide', 'approval.escalate',
    'lead.read', 'lead.write', 'lead.advance',
    'kpi.read', 'kpi.read_team',
    'notification.read',
  ],

  /* Doc 1: "Sees ONLY their own leads." No peer comparison, no team KPIs. */
  is_executive: [
    'catalog.read',
    'customer.read', 'customer.write',
    'activity.read', 'activity.write', 'task.read', 'task.write',
    'approval.request',
    'lead.read', 'lead.write', 'lead.advance',
    'kpi.read',
    'notification.read',
  ],

  /* Doc 2: "Sees only his 2 Executives' deals + his own." Approves discounts 3–10%. */
  sales_manager: [
    'user.read', 'directory.read', 'catalog.read',
    'customer.read', 'customer.write',
    'activity.read', 'activity.write', 'activity.read_team',
    'task.read', 'task.write', 'coaching.read', 'coaching.write',
    'approval.request', 'approval.decide', 'approval.escalate',
    'lead.read', 'lead.write', 'lead.advance', 'lead.gate_override',
    'workorder.read', 'install.read',
    'kpi.read', 'kpi.read_team', 'report.export',
    'notification.read', 'finance.read',
  ],

  /* Doc 2: own pipeline only. Self-approves discounts to 3%; above that, requests. */
  sales_executive: [
    'catalog.read',
    'customer.read', 'customer.write',
    'activity.read', 'activity.write', 'task.read', 'task.write',
    'approval.request',
    'lead.read', 'lead.write', 'lead.advance',
    'workorder.read', 'install.read',
    'kpi.read', 'report.export',
    'notification.read', 'finance.read',
  ],

  /* Doc 3: all orders, all engineers, all financial values, sole dispatch authority. */
  production_head: [
    'user.read', 'directory.read', 'catalog.read',
    'customer.read',
    'task.read', 'task.write',
    'approval.decide',
    'workorder.read', 'workorder.accept', 'workorder.commit_date',
    'workorder.advance', 'workorder.dispatch', 'workorder.deliver', 'workorder.upload',
    'install.read',
    'kpi.read', 'kpi.read_team', 'kpi.read_company', 'report.export',
    'notification.read', 'finance.read',
  ],

  /*
   * Doc 3: "Cannot see order value, revenue, or other engineers' work."
   * No finance.read — enforced by utils/redact.js at the response chokepoint, so the
   * values are never serialised into the engineer's session at all.
   * No workorder.dispatch — "engineers cannot self-dispatch" is a permission denial AND
   * a stage gate, two independent layers.
   */
  production_engineer: [
    'catalog.read',
    'task.read', 'task.write',
    'approval.request',
    'workorder.read', 'workorder.advance', 'workorder.upload',
    'kpi.read',
    'notification.read',
  ],

  /* Doc 4: all jobs, all field engineers, plus a read-only view of CS SLA. */
  install_head: [
    'user.read', 'directory.read', 'catalog.read',
    'customer.read',
    'activity.read', 'activity.read_team', 'task.read', 'task.write',
    'approval.decide',
    'workorder.read',
    'install.read', 'install.assign', 'install.execute', 'install.advance',
    'install.handover', 'install.upload', 'support.manage',
    'kpi.read', 'kpi.read_team', 'kpi.read_company', 'report.export',
    'notification.read', 'finance.read',
  ],

  /* Doc 4: the only role that sees agent-to-agent comparison data. */
  cs_manager: [
    'user.read', 'directory.read', 'catalog.read',
    'customer.read', 'customer.write',
    'activity.read', 'activity.write', 'activity.read_team',
    'task.read', 'task.write', 'coaching.read', 'coaching.write',
    'approval.decide', 'approval.escalate',
    'install.read', 'install.upload', 'support.manage',
    'feedback.log', 'feedback.corrective_action',
    'kpi.read', 'kpi.read_team', 'kpi.read_company', 'report.export',
    'notification.read', 'finance.read',
  ],

  /* Doc 4: own assigned jobs only. No financial data. */
  field_engineer: [
    'catalog.read',
    'customer.read',
    'activity.read', 'activity.write', 'task.read', 'task.write',
    'approval.request',
    'install.read', 'install.execute', 'install.advance', 'install.upload',
    'kpi.read',
    'notification.read',
  ],

  /* Doc 4: own tickets only. "Cannot see ... AMC contract values" → no finance.read. */
  cs_agent: [
    'catalog.read',
    'customer.read',
    'activity.read', 'activity.write', 'task.read', 'task.write',
    'approval.request',
    'install.read', 'install.upload', 'support.manage', 'feedback.log',
    'kpi.read',
    'notification.read',
  ],

  /* Unchanged: referrers hold nothing here and keep their narrow expo capture path. */
  referrer: [],
};

/** The eleven roles ERP Bible V3 names. `superadmin` and `referrer` are system roles. */
const V3_ROLES = [
  'sales_director', 'is_head', 'is_executive',
  'sales_manager', 'sales_executive',
  'production_head', 'production_engineer',
  'install_head', 'cs_manager', 'field_engineer', 'cs_agent',
];

/** Every role the system recognises. */
const ALL_ROLES = ['superadmin', ...V3_ROLES, 'referrer'];

/** Roles an admin may create through POST /api/auth/register. */
const REGISTERABLE_ROLES = ALL_ROLES.filter((r) => r !== 'referrer');

/**
 * How far into the org chart a role may read.
 *
 *   own  — only rows they own
 *   team — their own rows plus everyone in their reporting subtree (User.chain)
 *   all  — no row restriction
 *
 * Deliberately NOT a `domain` mode. Doc 2 defines Manager visibility by the reporting
 * line — "sees only his 2 Executives' deals + his own" — not by domain. Making domain a
 * scope axis would leak two managers who happen to share a domain into each other.
 * `domain` stays a data attribute for labelling and filtering: a query parameter, never
 * a security boundary.
 */
const ROLE_SCOPE = {
  superadmin: 'all',
  sales_director: 'all',
  is_head: 'team',
  is_executive: 'own',
  sales_manager: 'team',
  sales_executive: 'own',
  production_head: 'all',
  production_engineer: 'own',
  install_head: 'all',
  cs_manager: 'all',
  field_engineer: 'own',
  cs_agent: 'own',
  referrer: 'own',
};

/**
 * Roles whose Sales reach is limited to Inside Sales records.
 * Doc 1: the IS Head and IS Executive "cannot see Sales pipeline".
 */
const INSIDE_SALES_ONLY_ROLES = ['is_head', 'is_executive'];

function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || [];
}

/** True when the role holds ANY of the listed permissions. */
function roleHasAny(role, perms) {
  const held = permissionsFor(role);
  return perms.some((p) => held.includes(p));
}

/** Roles that hold a given permission. */
function rolesWith(permission) {
  return Object.keys(ROLE_PERMISSIONS).filter((r) => ROLE_PERMISSIONS[r].includes(permission));
}

/** The scope mode for a role; unknown roles get the most restrictive answer. */
function scopeModeFor(role) {
  return ROLE_SCOPE[role] || 'own';
}

module.exports = {
  PERMISSIONS, ROLE_PERMISSIONS, ALL_ROLES, V3_ROLES, REGISTERABLE_ROLES,
  ROLE_SCOPE, INSIDE_SALES_ONLY_ROLES,
  permissionsFor, roleHasAny, rolesWith, scopeModeFor,
};
