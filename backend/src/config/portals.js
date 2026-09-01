'use strict';

/**
 * portals.js — one portal per role: its sidebar, its landing route, and the exhaustive
 * list of routes it may reach.
 *
 * WHY THIS IS ON THE SERVER. `frontend/src/meta/usePipeline.ts` states the rule the v2
 * client was built to: "a hardcoded enum anywhere else in src/ is a defect" — every stage,
 * label and enum renders from `/api/meta/*`. The role taxonomy is an enum like any other,
 * so the portal map lives here and the client holds only a screen-key → component map,
 * which is the one thing that genuinely cannot be data.
 *
 * WHY nav AND routes COME FROM ONE OBJECT. v2 hid a sidebar link the caller had no
 * permission for and left the URL working: the page mounted, called the API, and rendered
 * a 403 banner. Deriving both from one entry means a role's sidebar and its reachable
 * routes cannot drift apart.
 *
 * The client guard is UX only. The server stays the authority — every route behind
 * `requirePermission`, with `assertRoutesGuarded()` in app.js refusing to boot if one is
 * missing. A portal entry cannot grant anything.
 *
 * HARD CONSTRAINT, like pipeline.js: pure data, no mongoose, no model requires.
 *
 * Paths follow ERP Bible V3 verbatim (`app.iinvsys.com/director/inside-sales/dashboard`,
 * `/is-head/handoff-queue`, `/prod-eng/orders/:id`, `/cs-agent/my-tickets`), so the
 * specification is the route table.
 */

/* Screens that exist today. Phase 1–4 add to this list as their screens land; a key here
   with no component in frontend/src/portal/registry.ts fails that file's own check. */
const SCREEN = {
  DASHBOARD:        'kpi.dashboard',
  LEADS_BOARD:      'lead.board',
  LEAD_DETAIL:      'lead.detail',
  HYGIENE:          'lead.hygiene',
  DELIVERY_BOARD:   'workorder.board',
  DELIVERY_DETAIL:  'workorder.detail',
  INSTALL_BOARD:    'install.board',
  INSTALL_DETAIL:   'install.detail',
  NOTIFICATIONS:    'notification.list',
  ADMIN:            'platform.admin',
  SETTINGS:         'platform.settings',

  /* ── Phase 1: Inside Sales (ERP Bible V3, document 1) ────────────────────── */
  IS_TEAM:          'is.team',          // IS-DIR-01 / IS-HD-01 — exec performance
  IS_EXEC_DRILL:    'is.exec',          // IS-DIR-02 / IS-HD-03 — one exec, full activity
  IS_CAPTURE:       'is.capture',       // IS-DIR-03 — capture and route
  IS_LEADS:         'is.leads',         // IS-HD-02 / IS-EX-02 — the lead list
  IS_LEAD_DETAIL:   'is.lead',          // IS-EX-03 / IS-EX-04 / IS-EX-05 — detail, log, BANT
  IS_HANDOFFS:      'is.handoffs',      // IS-HD-04 — the approval queue
  IS_ANALYTICS:     'is.analytics',     // IS-DIR-05 / IS-HD-05 — source reports
  IS_MY_DASHBOARD:  'is.myDashboard',   // IS-EX-01 — my leads, my tasks, my targets
  CUSTOMER_360:     'customer.360',     // IS-DIR-04 / SA-DIR-06
  CUSTOMERS:        'customer.list',
  TASKS:            'task.list',

  /* ── Phase 2: Sales / SPENCO (ERP Bible V3, document 2) ──────────────────── */
  SA_BOARD:         'sa.board',         // SA-DIR-05 / SA-MGR-05 / SA-EX-02
  SA_DEAL:          'sa.deal',          // SA-DIR-03 / SA-MGR-06 / SA-EX-03/04/06/07
  SA_TEAM:          'sa.team',          // SA-DIR-01/02 / SA-MGR-09
  SA_APPROVALS:     'sa.approvals',     // SA-DIR-07 / SA-MGR-08 / SA-DIR-09
  SA_FORECAST:      'sa.forecast',      // SA-DIR-08
  SA_CAPTURE:       'sa.capture',       // SA-DIR-04 / SA-EX-05
  SA_MY_DASHBOARD:  'sa.myDashboard',   // SA-EX-01 / SA-MGR-01
};

/* Route entries that appear in no sidebar — detail pages reached by clicking a row. */
const detail = (path, screen) => ({ path, screen, nav: false });

/**
 * @typedef {{key,landing,nav:Array,routes:Array}} Portal
 *   nav    — sections rendered in the sidebar, in order
 *   routes — the authoritative allowlist: every path this role may mount
 */
const PORTALS = {
  /* ── Doc 1 + doc 2: the Director sees every module ───────────────────────── */
  sales_director: {
    key: 'director',
    landing: '/director/dashboard',
    nav: [
      { section: 'Sales', items: [
        { label: 'Sales Command',  to: '/director/sales/dashboard', screen: SCREEN.SA_TEAM },
        { label: 'Full Pipeline',  to: '/director/sales/pipeline', screen: SCREEN.SA_BOARD },
        { label: 'Approvals',      to: '/director/sales/approvals', screen: SCREEN.SA_APPROVALS, badge: 'approvals' },
        { label: 'Forecast',       to: '/director/sales/forecast', screen: SCREEN.SA_FORECAST },
        { label: 'Create Deal',    to: '/director/sales/new', screen: SCREEN.SA_CAPTURE },
        { label: 'KPI Dashboard',  to: '/director/dashboard', screen: SCREEN.DASHBOARD },
        { label: 'Review Queue',   to: '/director/review', screen: SCREEN.HYGIENE },
      ] },
      { section: 'Inside Sales', items: [
        { label: 'IS Command',      to: '/director/inside-sales/dashboard', screen: SCREEN.IS_TEAM },
        { label: 'All IS Leads',    to: '/director/inside-sales/leads', screen: SCREEN.IS_LEADS },
        { label: 'Create Lead',     to: '/director/leads/new', screen: SCREEN.IS_CAPTURE },
        { label: 'IS Analytics',    to: '/director/inside-sales/analytics', screen: SCREEN.IS_ANALYTICS },
      ] },
      { section: 'Accounts', items: [
        { label: 'Customer 360', to: '/director/customers', screen: SCREEN.CUSTOMERS },
      ] },
      { section: 'Other Modules', items: [
        { label: 'Production',   to: '/director/production', screen: SCREEN.DELIVERY_BOARD },
        { label: 'Installation', to: '/director/installation', screen: SCREEN.INSTALL_BOARD },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/director/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    routes: [
      detail('/director/pipeline', SCREEN.LEADS_BOARD),
      detail('/director/pipeline/:id', SCREEN.LEAD_DETAIL),
      /* SA-DIR-03: click any executive on the command dashboard. */
      detail('/director/sales/exec/:id', SCREEN.SA_TEAM),
      detail('/director/sales/deals/:id', SCREEN.SA_DEAL),
      detail('/director/production/:id', SCREEN.DELIVERY_DETAIL),
      detail('/director/installation/:id', SCREEN.INSTALL_DETAIL),
      /* IS-DIR-02 — click any exec row on the command dashboard. */
      detail('/director/inside-sales/exec/:id', SCREEN.IS_EXEC_DRILL),
      detail('/director/inside-sales/leads/:id', SCREEN.IS_LEAD_DETAIL),
      /* IS-DIR-04 — searched from anywhere, linked from every activity. */
      detail('/director/customers/:id', SCREEN.CUSTOMER_360),
    ],
  },

  /* ── Doc 1: "Cannot see Sales pipeline" — no delivery, no installation ──── */
  is_head: {
    key: 'is-head',
    landing: '/is-head/dashboard',
    nav: [
      { section: 'My Team', items: [
        { label: 'Team Dashboard',  to: '/is-head/dashboard', screen: SCREEN.IS_TEAM },
        { label: 'All Team Leads',  to: '/is-head/leads', screen: SCREEN.IS_LEADS },
        { label: 'Lead Assignment', to: '/is-head/assignment', screen: SCREEN.IS_LEADS },
        { label: 'Handoff Queue',   to: '/is-head/handoff-queue', screen: SCREEN.IS_HANDOFFS, badge: 'handoffs' },
      ] },
      { section: 'Reports', items: [
        { label: 'Team Reports', to: '/is-head/reports', screen: SCREEN.IS_ANALYTICS },
        { label: 'Review Queue', to: '/is-head/review', screen: SCREEN.HYGIENE },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/is-head/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    routes: [
      detail('/is-head/leads/:id', SCREEN.IS_LEAD_DETAIL),
      /* IS-HD-03 — per-exec activity, the coaching view. */
      detail('/is-head/exec/:id', SCREEN.IS_EXEC_DRILL),
      detail('/is-head/customers/:id', SCREEN.CUSTOMER_360),
      detail('/is-head/leads/new', SCREEN.IS_CAPTURE),
    ],
  },

  is_executive: {
    key: 'is-exec',
    landing: '/is-exec/my-dashboard',
    nav: [
      { section: 'My Work', items: [
        { label: 'My Dashboard', to: '/is-exec/my-dashboard', screen: SCREEN.IS_MY_DASHBOARD },
        { label: 'My Leads',     to: '/is-exec/leads', screen: SCREEN.IS_LEADS },
        { label: 'My Tasks',     to: '/is-exec/tasks', screen: SCREEN.TASKS, badge: 'tasks' },
      ] },
      { section: 'Actions', items: [
        { label: 'Capture Lead', to: '/is-exec/leads/new', screen: SCREEN.IS_CAPTURE },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/is-exec/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    /* No team dashboard, no peer list, no analytics. Doc 1: "Personal targets visible —
       no peer comparison shown." The omission is the requirement. */
    routes: [
      detail('/is-exec/leads/:id', SCREEN.IS_LEAD_DETAIL),
      detail('/is-exec/customers/:id', SCREEN.CUSTOMER_360),
    ],
  },

  /* ── Doc 2 ───────────────────────────────────────────────────────────────── */
  sales_manager: {
    key: 'sales-mgr',
    landing: '/sales-mgr/dashboard',
    nav: [
      { section: 'My Team', items: [
        { label: 'Team Dashboard', to: '/sales-mgr/dashboard', screen: SCREEN.SA_TEAM },
        { label: 'Team Pipeline',  to: '/sales-mgr/pipeline', screen: SCREEN.SA_BOARD },
        { label: 'My Own Deals',   to: '/sales-mgr/my-deals', screen: SCREEN.SA_MY_DASHBOARD },
      ] },
      { section: 'Actions', items: [
        { label: 'Discount Approvals', to: '/sales-mgr/approvals', screen: SCREEN.SA_APPROVALS, badge: 'approvals' },
        { label: 'New Deal',   to: '/sales-mgr/new', screen: SCREEN.SA_CAPTURE },
        { label: 'Customers',  to: '/sales-mgr/customers', screen: SCREEN.CUSTOMERS },
        { label: 'My Tasks',   to: '/sales-mgr/tasks', screen: SCREEN.TASKS, badge: 'tasks' },
      ] },
      { section: 'Other Modules', items: [
        { label: 'Delivery',     to: '/sales-mgr/delivery', screen: SCREEN.DELIVERY_BOARD },
        { label: 'Installation', to: '/sales-mgr/installation', screen: SCREEN.INSTALL_BOARD },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/sales-mgr/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    /* No company-wide figures and no other manager's team — doc 2 SA-MGR-01:
       "For company-wide figures, the Sales Director's dashboard is the right source." */
    routes: [
      detail('/sales-mgr/deals/:id', SCREEN.SA_DEAL),
      detail('/sales-mgr/exec/:id', SCREEN.SA_TEAM),
      detail('/sales-mgr/customers/:id', SCREEN.CUSTOMER_360),
      detail('/sales-mgr/delivery/:id', SCREEN.DELIVERY_DETAIL),
      detail('/sales-mgr/installation/:id', SCREEN.INSTALL_DETAIL),
      detail('/sales-mgr/review', SCREEN.HYGIENE),
    ],
  },


  sales_executive: {
    key: 'sales-exec',
    landing: '/sales-exec/my-dashboard',
    nav: [
      { section: 'My Work', items: [
        { label: 'My Dashboard',    to: '/sales-exec/my-dashboard', screen: SCREEN.SA_MY_DASHBOARD },
        { label: 'My SPENCO Board', to: '/sales-exec/pipeline', screen: SCREEN.SA_BOARD },
        { label: 'My Tasks',        to: '/sales-exec/tasks', screen: SCREEN.TASKS, badge: 'tasks' },
        { label: 'My Accounts',     to: '/sales-exec/customers', screen: SCREEN.CUSTOMERS },
      ] },
      { section: 'Actions', items: [
        { label: 'New Deal', to: '/sales-exec/new', screen: SCREEN.SA_CAPTURE },
      ] },
      { section: 'Downstream', items: [
        { label: 'Delivery',     to: '/sales-exec/delivery', screen: SCREEN.DELIVERY_BOARD },
        { label: 'Installation', to: '/sales-exec/installation', screen: SCREEN.INSTALL_BOARD },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/sales-exec/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    /* No team dashboard, no approvals queue, no forecast. Doc 2: "No other exec's data,
       no company pipeline, no manager's deals." */
    routes: [
      detail('/sales-exec/deals/:id', SCREEN.SA_DEAL),
      detail('/sales-exec/customers/:id', SCREEN.CUSTOMER_360),
      detail('/sales-exec/delivery/:id', SCREEN.DELIVERY_DETAIL),
      detail('/sales-exec/installation/:id', SCREEN.INSTALL_DETAIL),
    ],
  },


  /* ── Doc 3: no lead access at all, in either direction ───────────────────── */
  production_head: {
    key: 'prod-head',
    landing: '/prod-head/dashboard',
    nav: [
      { section: 'Production', items: [
        { label: 'Dashboard',  to: '/prod-head/dashboard', screen: SCREEN.DASHBOARD },
        { label: 'All Orders', to: '/prod-head/orders', screen: SCREEN.DELIVERY_BOARD },
      ] },
      { section: 'Downstream', items: [
        { label: 'Installation', to: '/prod-head/installation', screen: SCREEN.INSTALL_BOARD },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/prod-head/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    routes: [
      detail('/prod-head/orders/:id', SCREEN.DELIVERY_DETAIL),
      detail('/prod-head/installation/:id', SCREEN.INSTALL_DETAIL),
    ],
  },

  /* Doc 3: "no financial values, no other engineers' orders, no revenue data." */
  production_engineer: {
    key: 'prod-eng',
    landing: '/prod-eng/orders',
    nav: [
      { section: 'My Work', items: [
        { label: 'My Orders', to: '/prod-eng/orders', screen: SCREEN.DELIVERY_BOARD },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/prod-eng/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    routes: [detail('/prod-eng/orders/:id', SCREEN.DELIVERY_DETAIL)],
  },

  /* ── Doc 4 ───────────────────────────────────────────────────────────────── */
  install_head: {
    key: 'install-head',
    landing: '/install-head/dashboard',
    nav: [
      { section: 'Installation', items: [
        { label: 'Dashboard', to: '/install-head/dashboard', screen: SCREEN.DASHBOARD },
        { label: 'All Jobs',  to: '/install-head/jobs', screen: SCREEN.INSTALL_BOARD },
      ] },
      { section: 'Upstream', items: [
        { label: 'Deliveries', to: '/install-head/deliveries', screen: SCREEN.DELIVERY_BOARD },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/install-head/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    routes: [
      detail('/install-head/jobs/:id', SCREEN.INSTALL_DETAIL),
      detail('/install-head/deliveries/:id', SCREEN.DELIVERY_DETAIL),
    ],
  },

  cs_manager: {
    key: 'cs-mgr',
    landing: '/cs-mgr/dashboard',
    nav: [
      { section: 'Support', items: [
        { label: 'Dashboard', to: '/cs-mgr/dashboard', screen: SCREEN.DASHBOARD },
        { label: 'All Jobs',  to: '/cs-mgr/jobs', screen: SCREEN.INSTALL_BOARD },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/cs-mgr/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    routes: [detail('/cs-mgr/jobs/:id', SCREEN.INSTALL_DETAIL)],
  },

  field_engineer: {
    key: 'field-eng',
    landing: '/field-eng/jobs',
    nav: [
      { section: 'My Work', items: [
        { label: 'My Jobs', to: '/field-eng/jobs', screen: SCREEN.INSTALL_BOARD },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/field-eng/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    routes: [detail('/field-eng/jobs/:id', SCREEN.INSTALL_DETAIL)],
  },

  /* Doc 4: "You are viewing only your own tickets." */
  cs_agent: {
    key: 'cs-agent',
    landing: '/cs-agent/jobs',
    nav: [
      { section: 'My Work', items: [
        { label: 'My Jobs', to: '/cs-agent/jobs', screen: SCREEN.INSTALL_BOARD },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/cs-agent/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    routes: [detail('/cs-agent/jobs/:id', SCREEN.INSTALL_DETAIL)],
  },

  /* ── Platform ────────────────────────────────────────────────────────────── */
  superadmin: {
    key: 'admin',
    landing: '/admin/dashboard',
    nav: [
      { section: 'Overview', items: [
        { label: 'Dashboard',    to: '/admin/dashboard', screen: SCREEN.DASHBOARD },
        { label: 'Pipeline',     to: '/admin/pipeline', screen: SCREEN.LEADS_BOARD },
        { label: 'Review Queue', to: '/admin/review', screen: SCREEN.HYGIENE },
      ] },
      { section: 'Operations', items: [
        { label: 'Delivery',     to: '/admin/delivery', screen: SCREEN.DELIVERY_BOARD },
        { label: 'Installation', to: '/admin/installation', screen: SCREEN.INSTALL_BOARD },
      ] },
      { section: 'Platform', items: [
        { label: 'Admin',    to: '/admin/manage', screen: SCREEN.ADMIN },
        { label: 'Settings', to: '/admin/settings', screen: SCREEN.SETTINGS },
        { label: 'Alerts',   to: '/admin/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    routes: [
      detail('/admin/pipeline/:id', SCREEN.LEAD_DETAIL),
      detail('/admin/delivery/:id', SCREEN.DELIVERY_DETAIL),
      detail('/admin/installation/:id', SCREEN.INSTALL_DETAIL),
    ],
  },

  /* Referrers use the expo capture path in the legacy app; they mount no portal here. */
  referrer: { key: 'referrer', landing: '/login', nav: [], routes: [] },
};

/**
 * The portal for a role, with `routes` flattened to include everything in `nav` — so
 * `screens` is exhaustive and a link can never point somewhere the role may not mount.
 */
function portalFor(role) {
  const p = PORTALS[role];
  if (!p) return null;

  const navRoutes = p.nav.flatMap((section) => section.items.map(
    (item) => ({ path: item.to, screen: item.screen, nav: true }),
  ));
  const routes = [...navRoutes, ...p.routes];

  return {
    key: p.key,
    landing: p.landing,
    nav: p.nav,
    routes,
    screens: [...new Set(routes.map((r) => r.screen))],
  };
}

module.exports = { PORTALS, SCREEN, portalFor };
