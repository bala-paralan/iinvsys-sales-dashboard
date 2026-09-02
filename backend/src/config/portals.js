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

  /* ── Phase 3: Production & Delivery (ERP Bible V3, document 3) ───────────── */
  PD_DASHBOARD:     'pd.dashboard',     // PD-HD-01 / PD-ENG-01
  PD_ORDER:         'pd.order',         // PD-HD-03/06 / PD-ENG-02/03/04/05
  PD_WORKLOAD:      'pd.workload',      // PD-HD-02
  PD_QC:            'pd.qc',            // PD-HD-07
  PD_DISPATCH:      'pd.dispatch',      // PD-HD-08 / PD-HD-09
  PD_GANTT:         'pd.gantt',         // PD-HD-05

  /* ── Phase 4: Installation & Customer Support (document 4) ───────────────── */
  IC_JOBS:          'ic.jobs',          // IC-HD-01 / IC-FE-01
  IC_SIGNOFFS:      'ic.signoffs',      // IC-HD-04
  IC_TICKETS:       'ic.tickets',       // IC-CSM-02 / IC-AG-01
  IC_TICKET:        'ic.ticket',        // IC-AG-02
  IC_AGENTS:        'ic.agents',        // IC-CSM-01 / IC-CSM-03
  IC_CONTRACTS:     'ic.contracts',     // IC-CSM-04 / IC-AG-03

  /* Screens both executive tracks list in their sidebars — doc 1 IS-EX-01 and
     doc 2 SA-EX-01 name all three. */
  LOG_ACTIVITY:     'activity.log',     // IS-EX-04 / SA-EX-04
  MY_PERFORMANCE:   'me.performance',   // IS-EX "My Performance" / SA-EX "My Performance"
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
        { label: 'Production',   to: '/director/production', screen: SCREEN.PD_DASHBOARD },
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
      detail('/director/production/:id', SCREEN.PD_ORDER),
      detail('/director/delivery', SCREEN.DELIVERY_BOARD),
      detail('/director/delivery/:id', SCREEN.DELIVERY_DETAIL),
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
        { label: 'Log Activity',    to: '/is-head/log-activity', screen: SCREEN.LOG_ACTIVITY },
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
        { label: 'Log Activity', to: '/is-exec/log-activity', screen: SCREEN.LOG_ACTIVITY },
      ] },
      { section: 'Actions', items: [
        { label: 'Capture Lead',    to: '/is-exec/leads/new', screen: SCREEN.IS_CAPTURE },
        /* Doc 1 lists "Request Handoff" as an action. The request itself is raised on a
           lead, so this is the shortlist of leads that are ready for one. */
        { label: 'Request Handoff', to: '/is-exec/leads?isStage=is_qualified', screen: SCREEN.IS_LEADS },
        { label: 'My Performance',  to: '/is-exec/performance', screen: SCREEN.MY_PERFORMANCE },
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
        { label: 'New Deal',     to: '/sales-mgr/new', screen: SCREEN.SA_CAPTURE },
        { label: 'Log Activity', to: '/sales-mgr/log-activity', screen: SCREEN.LOG_ACTIVITY },
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
        { label: 'New Deal',       to: '/sales-exec/new', screen: SCREEN.SA_CAPTURE },
        { label: 'Log Activity',   to: '/sales-exec/log-activity', screen: SCREEN.LOG_ACTIVITY },
        { label: 'My Performance', to: '/sales-exec/performance', screen: SCREEN.MY_PERFORMANCE },
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
        { label: 'Dashboard',    to: '/prod-head/dashboard', screen: SCREEN.PD_DASHBOARD },
        { label: 'All Orders',   to: '/prod-head/orders', screen: SCREEN.PD_DASHBOARD },
        { label: 'Engineers',    to: '/prod-head/engineers', screen: SCREEN.PD_WORKLOAD },
        { label: 'Gantt',        to: '/prod-head/gantt', screen: SCREEN.PD_GANTT },
        { label: 'QC Approvals', to: '/prod-head/qc', screen: SCREEN.PD_QC, badge: 'qc' },
      ] },
      { section: 'Dispatch', items: [
        { label: 'Dispatch & POD', to: '/prod-head/dispatch', screen: SCREEN.PD_DISPATCH, badge: 'dispatch' },
        { label: 'Delivery Board', to: '/prod-head/delivery', screen: SCREEN.DELIVERY_BOARD },
      ] },
      { section: 'Account', items: [
        { label: 'Reports', to: '/prod-head/reports', screen: SCREEN.DASHBOARD },
        { label: 'Alerts',  to: '/prod-head/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    routes: [
      detail('/prod-head/orders/:id', SCREEN.PD_ORDER),
      detail('/prod-head/delivery/:id', SCREEN.DELIVERY_DETAIL),
    ],
  },


  /* Doc 3: "no financial values, no other engineers' orders, no revenue data." */
  production_engineer: {
    key: 'prod-eng',
    landing: '/prod-eng/my-dashboard',
    nav: [
      { section: 'My Work', items: [
        { label: 'My Dashboard', to: '/prod-eng/my-dashboard', screen: SCREEN.PD_DASHBOARD },
        { label: 'My Orders',    to: '/prod-eng/orders', screen: SCREEN.PD_DASHBOARD },
        { label: 'My Tasks',     to: '/prod-eng/tasks', screen: SCREEN.TASKS, badge: 'tasks' },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/prod-eng/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    /* No engineer workload, no QC approvals, no dispatch, no Gantt, no delivery board.
       Doc 3: "Cannot see order value, revenue, or other engineers' work." */
    routes: [detail('/prod-eng/orders/:id', SCREEN.PD_ORDER)],
  },


  /* ── Doc 4 ───────────────────────────────────────────────────────────────── */
  install_head: {
    key: 'install-head',
    landing: '/install-head/dashboard',
    nav: [
      { section: 'Installation', items: [
        { label: 'Dashboard',     to: '/install-head/dashboard', screen: SCREEN.IC_JOBS },
        { label: 'All Jobs',      to: '/install-head/jobs', screen: SCREEN.INSTALL_BOARD },
        { label: 'Sign-Off Queue', to: '/install-head/sign-offs', screen: SCREEN.IC_SIGNOFFS, badge: 'signoffs' },
      ] },
      { section: 'CS Overview', items: [
        /* Doc 4 IC-HD-01: the Head gets a READ-ONLY view of CS SLA health, "so they know
           if a customer is having support issues on a newly installed product." */
        { label: 'CS SLA Status', to: '/install-head/cs-sla', screen: SCREEN.IC_AGENTS },
        { label: 'Contracts',     to: '/install-head/contracts', screen: SCREEN.IC_CONTRACTS },
      ] },
      { section: 'Account', items: [
        { label: 'Reports', to: '/install-head/reports', screen: SCREEN.DASHBOARD },
        { label: 'Alerts',  to: '/install-head/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    routes: [
      detail('/install-head/jobs/:id', SCREEN.INSTALL_DETAIL),
      detail('/install-head/customers/:id', SCREEN.CUSTOMER_360),
    ],
  },


  cs_manager: {
    key: 'cs-mgr',
    landing: '/cs-mgr/dashboard',
    nav: [
      { section: 'Support', items: [
        { label: 'Dashboard',   to: '/cs-mgr/dashboard', screen: SCREEN.IC_AGENTS },
        { label: 'All Tickets', to: '/cs-mgr/tickets', screen: SCREEN.IC_TICKETS, badge: 'tickets' },
        { label: 'Agents',      to: '/cs-mgr/agents', screen: SCREEN.IC_AGENTS },
      ] },
      { section: 'Contracts', items: [
        { label: 'AMC Tracker',      to: '/cs-mgr/contracts', screen: SCREEN.IC_CONTRACTS },
        { label: 'Renewal Pipeline', to: '/cs-mgr/renewals', screen: SCREEN.IC_CONTRACTS, badge: 'renewals' },
      ] },
      { section: 'Account', items: [
        { label: 'Customers', to: '/cs-mgr/customers', screen: SCREEN.CUSTOMERS },
        { label: 'Reports',   to: '/cs-mgr/reports', screen: SCREEN.DASHBOARD },
        { label: 'Alerts',    to: '/cs-mgr/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    routes: [
      detail('/cs-mgr/tickets/:id', SCREEN.IC_TICKET),
      detail('/cs-mgr/customers/:id', SCREEN.CUSTOMER_360),
      detail('/cs-mgr/installation/:id', SCREEN.INSTALL_DETAIL),
    ],
  },


  field_engineer: {
    key: 'field-eng',
    landing: '/field-eng/my-jobs',
    nav: [
      { section: 'My Work', items: [
        { label: 'My Jobs',  to: '/field-eng/my-jobs', screen: SCREEN.IC_JOBS },
        { label: 'My Tasks', to: '/field-eng/tasks', screen: SCREEN.TASKS, badge: 'tasks' },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/field-eng/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    /* No CS tickets, no contracts, no other engineer's jobs. */
    routes: [detail('/field-eng/jobs/:id', SCREEN.INSTALL_DETAIL)],
  },


  /* Doc 4: "You are viewing only your own tickets." */
  cs_agent: {
    key: 'cs-agent',
    landing: '/cs-agent/my-tickets',
    nav: [
      { section: 'My Work', items: [
        { label: 'My Tickets', to: '/cs-agent/my-tickets', screen: SCREEN.IC_TICKETS, badge: 'tickets' },
        { label: 'My Tasks',   to: '/cs-agent/tasks', screen: SCREEN.TASKS, badge: 'tasks' },
      ] },
      { section: 'Reference', items: [
        /* IC-AG-03: read-only, and the values are stripped server-side. */
        { label: 'AMC Reference', to: '/cs-agent/contracts', screen: SCREEN.IC_CONTRACTS },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/cs-agent/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    /* No agent comparison, no team SLA, no renewal pipeline. Doc 4 IC-AG-01. */
    routes: [
      detail('/cs-agent/tickets/:id', SCREEN.IC_TICKET),
      detail('/cs-agent/customers/:id', SCREEN.CUSTOMER_360),
    ],
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

  /* A nav item may carry a query string — "Request Handoff" is the lead list pre-filtered
     to what is ready for one. The LINK keeps it; the ROUTE must not, or React Router
     tries to match a path containing "?" and the screen never mounts. */
  const navRoutes = p.nav.flatMap((section) => section.items.map(
    (item) => ({ path: item.to.split('?')[0], screen: item.screen, nav: true }),
  ));

  /* Two nav entries may point at one screen on different filters, which would register
     the same path twice. Keep the first. */
  const seen = new Set();
  const routes = [...navRoutes, ...p.routes].filter((r) => {
    if (seen.has(r.path)) return false;
    seen.add(r.path);
    return true;
  });

  return {
    key: p.key,
    landing: p.landing,
    nav: p.nav,
    routes,
    screens: [...new Set(routes.map((r) => r.screen))],
  };
}

module.exports = { PORTALS, SCREEN, portalFor };
