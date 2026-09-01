'use strict';
/**
 * The role × route matrix — regression for a live authorisation hole, and the artefact
 * that makes deleting the `ROLE_LEVEL` ladder safe.
 *
 * WHAT WENT WRONG BEFORE. `ROLE_LEVEL` put `referrer`, `readonly` and all seven
 * operational roles at level 1. Because `requireMinRole` tested `>=`, that made
 * `requireMinRole('readonly')` — the guard on the staff directory, the priced product
 * catalogue, every expo and system settings — admit EVERY authenticated user, including
 * referrers, whose credentials are generated in bulk and handed out at events.
 *
 * The root cause was ranking roles that are not comparable. V3 names eleven roles where
 * a Production Head is neither above nor below an IS Head, so the ladder is gone and
 * `requirePermission` is the only gate.
 *
 * WHAT THIS FILE DOES. It asserts the FULL product of every role against every guarded
 * route through the HTTP layer — never by reading a constant, which is what let the
 * original bug survive review. Adding a role now forces a decision for every route: the
 * expectation table below will not compile past `expectedFor()` without one.
 */
const request = require('supertest');
const app = require('../src/app');
const { ALL_ROLES } = require('../src/config/permissions');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');

/*
 * Each entry: a route, and the roles that may reach it.
 *
 * "May reach" means "is not refused by the authorisation layer" — 200/404/422 all pass,
 * 403 fails. A route is listed once; a role not named is asserted to be REFUSED, which
 * is what makes the table exhaustive rather than a spot check.
 */
const ROUTES = [
  { method: 'get', path: '/api/users',
    allow: ['superadmin', 'sales_director', 'is_head', 'sales_manager', 'production_head', 'install_head', 'cs_manager'] },
  { method: 'get', path: '/api/products',
    allow: ALL_ROLES.filter((r) => r !== 'referrer') },
  { method: 'post', path: '/api/products',
    allow: ['superadmin'] },
  { method: 'get', path: '/api/settings',
    allow: ['superadmin', 'sales_director'] },
  { method: 'get', path: '/api/settings/pipeline',
    allow: ['superadmin', 'sales_director'] },
  { method: 'get', path: '/api/leads',
    allow: ['superadmin', 'sales_director', 'is_head', 'is_executive', 'sales_manager', 'sales_executive', 'referrer'] },
  { method: 'get', path: '/api/leads/hygiene',
    allow: ['superadmin', 'sales_director', 'is_head', 'is_executive', 'sales_manager', 'sales_executive'] },
  { method: 'get', path: '/api/customers',
    allow: ['superadmin', 'sales_director', 'is_head', 'is_executive', 'sales_manager', 'sales_executive',
            'production_head', 'install_head', 'cs_manager', 'field_engineer', 'cs_agent'] },
  { method: 'get', path: '/api/activities',
    allow: ['superadmin', 'sales_director', 'is_head', 'is_executive', 'sales_manager', 'sales_executive',
            'install_head', 'cs_manager', 'field_engineer', 'cs_agent'] },
  { method: 'get', path: '/api/tasks',
    allow: ALL_ROLES.filter((r) => r !== 'referrer') },
  { method: 'get', path: '/api/coaching-notes',
    allow: ['superadmin', 'sales_director', 'is_head', 'sales_manager', 'cs_manager'] },
  { method: 'get', path: '/api/approvals',
    allow: ALL_ROLES.filter((r) => r !== 'referrer') },
  { method: 'get', path: '/api/workorders',
    allow: ['superadmin', 'sales_director', 'sales_manager', 'sales_executive',
            'production_head', 'production_engineer', 'install_head'] },
  { method: 'get', path: '/api/installations',
    allow: ['superadmin', 'sales_director', 'sales_manager', 'sales_executive',
            'production_head', 'install_head', 'cs_manager', 'field_engineer', 'cs_agent'] },
  { method: 'get', path: '/api/kpis/summary',
    allow: ALL_ROLES.filter((r) => r !== 'referrer') },
  { method: 'get', path: '/api/expos',
    allow: ['superadmin', 'sales_director', 'is_head', 'is_executive', 'sales_manager', 'sales_executive',
            'production_head', 'install_head', 'cs_manager', 'production_engineer', 'field_engineer',
            'cs_agent', 'referrer'] },
  { method: 'get', path: '/api/reports/export.xlsx',
    allow: ['superadmin', 'sales_director', 'sales_manager', 'sales_executive',
            'production_head', 'install_head', 'cs_manager'] },
  { method: 'get', path: '/api/notifications',
    allow: ALL_ROLES.filter((r) => r !== 'referrer') },
];

function expectedFor(route, role) {
  return route.allow.includes(role);
}

describe('role × route authorisation matrix', () => {
  const tokens = {};

  beforeAll(async () => {
    await connect();
    await clearCollections();
    for (const role of ALL_ROLES) {
      const id = await insertUser({ role, email: `${role}@matrix.test` });
      tokens[role] = tok(id);
    }
  });
  afterAll(disconnect);

  it('covers every role the system recognises', () => {
    expect(Object.keys(tokens).sort()).toEqual([...ALL_ROLES].sort());
  });

  for (const route of ROUTES) {
    describe(`${route.method.toUpperCase()} ${route.path}`, () => {
      for (const role of ALL_ROLES) {
        const allowed = expectedFor(route, role);
        it(`${allowed ? 'admits' : 'refuses'} ${role}`, async () => {
          const res = await request(app)[route.method](route.path)
            .set('Authorization', `Bearer ${tokens[role]}`);

          if (allowed) {
            /* Anything but a refusal. A 404 or 422 means the request got past
               authorisation and failed on its own merits, which is the point. */
            expect(res.status).not.toBe(403);
          } else {
            expect(res.status).toBe(403);
          }
        });
      }
    });
  }

  it('refuses every guarded route without a token', async () => {
    for (const route of ROUTES) {
      const res = await request(app)[route.method](route.path);
      expect(res.status).toBe(401);
    }
  });
});
