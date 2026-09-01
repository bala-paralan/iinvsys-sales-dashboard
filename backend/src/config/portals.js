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
        { label: 'Sales Command', to: '/director/dashboard', screen: SCREEN.DASHBOARD },
        { label: 'Full Pipeline', to: '/director/pipeline', screen: SCREEN.LEADS_BOARD },
        { label: 'Review Queue',  to: '/director/review', screen: SCREEN.HYGIENE },
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
      detail('/director/pipeline/:id', SCREEN.LEAD_DETAIL),
      detail('/director/production/:id', SCREEN.DELIVERY_DETAIL),
      detail('/director/installation/:id', SCREEN.INSTALL_DETAIL),
    ],
  },

  /* ── Doc 1: "Cannot see Sales pipeline" — no delivery, no installation ──── */
  is_head: {
    key: 'is-head',
    landing: '/is-head/dashboard',
    nav: [
      { section: 'My Team', items: [
        { label: 'Team Dashboard', to: '/is-head/dashboard', screen: SCREEN.DASHBOARD },
        { label: 'All Team Leads', to: '/is-head/leads', screen: SCREEN.LEADS_BOARD },
        { label: 'Review Queue',   to: '/is-head/review', screen: SCREEN.HYGIENE },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/is-head/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    routes: [detail('/is-head/leads/:id', SCREEN.LEAD_DETAIL)],
  },

  is_executive: {
    key: 'is-exec',
    landing: '/is-exec/dashboard',
    nav: [
      { section: 'My Work', items: [
        { label: 'My Dashboard', to: '/is-exec/dashboard', screen: SCREEN.DASHBOARD },
        { label: 'My Leads',     to: '/is-exec/leads', screen: SCREEN.LEADS_BOARD },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/is-exec/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    routes: [detail('/is-exec/leads/:id', SCREEN.LEAD_DETAIL)],
  },

  /* ── Doc 2 ───────────────────────────────────────────────────────────────── */
  sales_manager: {
    key: 'sales-mgr',
    landing: '/sales-mgr/dashboard',
    nav: [
      { section: 'My Team', items: [
        { label: 'Team Dashboard', to: '/sales-mgr/dashboard', screen: SCREEN.DASHBOARD },
        { label: 'Team Pipeline',  to: '/sales-mgr/pipeline', screen: SCREEN.LEADS_BOARD },
        { label: 'Review Queue',   to: '/sales-mgr/review', screen: SCREEN.HYGIENE },
      ] },
      { section: 'Downstream', items: [
        { label: 'Delivery',     to: '/sales-mgr/delivery', screen: SCREEN.DELIVERY_BOARD },
        { label: 'Installation', to: '/sales-mgr/installation', screen: SCREEN.INSTALL_BOARD },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/sales-mgr/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    routes: [
      detail('/sales-mgr/pipeline/:id', SCREEN.LEAD_DETAIL),
      detail('/sales-mgr/delivery/:id', SCREEN.DELIVERY_DETAIL),
      detail('/sales-mgr/installation/:id', SCREEN.INSTALL_DETAIL),
    ],
  },

  sales_executive: {
    key: 'sales-exec',
    landing: '/sales-exec/dashboard',
    nav: [
      { section: 'My Work', items: [
        { label: 'My Dashboard',    to: '/sales-exec/dashboard', screen: SCREEN.DASHBOARD },
        { label: 'My SPENCO Board', to: '/sales-exec/pipeline', screen: SCREEN.LEADS_BOARD },
      ] },
      { section: 'Downstream', items: [
        { label: 'Delivery',     to: '/sales-exec/delivery', screen: SCREEN.DELIVERY_BOARD },
        { label: 'Installation', to: '/sales-exec/installation', screen: SCREEN.INSTALL_BOARD },
      ] },
      { section: 'Account', items: [
        { label: 'Alerts', to: '/sales-exec/alerts', screen: SCREEN.NOTIFICATIONS, badge: 'notifications' },
      ] },
    ],
    routes: [
      detail('/sales-exec/pipeline/:id', SCREEN.LEAD_DETAIL),
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
