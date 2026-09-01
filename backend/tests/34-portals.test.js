'use strict';
/**
 * Per-role portals — "All screens, all flows, no shared views", on every one of the four
 * document headers.
 *
 * Two properties matter here.
 *
 * 1. A ROLE'S SIDEBAR AND ITS REACHABLE ROUTES CANNOT DRIFT. v2 hid a nav link the caller
 *    had no permission for and left the URL working: the page mounted, called the API and
 *    rendered a 403 banner. Both halves now derive from one object.
 *
 * 2. A ROLE OR PERMISSION CHANGE REACHES AN OPEN CLIENT. The per-user block used to ride
 *    inside the pipeline payload, which the client caches with `staleTime: Infinity` keyed
 *    on a `version` hash that did not cover the taxonomy — so changing someone's role
 *    changed what the server sent and changed nothing about what their tab believed.
 */
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const app = require('../src/app');
const { ALL_ROLES, permissionsFor } = require('../src/config/permissions');
const { PORTALS, portalFor } = require('../src/config/portals');
const pipeline = require('../src/config/pipeline');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const roles = require('./helpers/roles');

describe('portal registry', () => {
  it('gives every recognised role a portal', () => {
    for (const role of ALL_ROLES) expect(PORTALS[role]).toBeDefined();
  });

  it('declares no portal for a role that does not exist', () => {
    for (const role of Object.keys(PORTALS)) expect(ALL_ROLES).toContain(role);
  });

  it.each(ALL_ROLES.filter((r) => r !== 'referrer'))(
    '%s lands on a route its own portal lists', (role) => {
      const p = portalFor(role);
      expect(p.routes.map((r) => r.path)).toContain(p.landing);
    });

  it.each(ALL_ROLES)('%s has no duplicate route paths', (role) => {
    const paths = portalFor(role).routes.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('makes every nav link a reachable route — the v2 drift bug', () => {
    for (const role of ALL_ROLES) {
      const p = portalFor(role);
      const reachable = new Set(p.routes.map((r) => r.path));
      for (const section of p.nav) {
        for (const item of section.items) {
          expect({ role, link: item.to, reachable: reachable.has(item.to) })
            .toEqual({ role, link: item.to, reachable: true });
        }
      }
    }
  });

  it('lists no screen the client cannot render', () => {
    /* The client holds screen-key → component and nothing else. A key here with no entry
       there renders a placeholder rather than a blank page, but the mismatch should still
       be visible in CI rather than in someone's browser. */
    const registry = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'portal', 'registry.ts'), 'utf8',
    );
    for (const role of ALL_ROLES) {
      for (const screen of portalFor(role).screens) {
        expect({ role, screen, inRegistry: registry.includes(`'${screen}'`) })
          .toEqual({ role, screen, inRegistry: true });
      }
    }
  });

  it('gives a role no screen its permissions cannot support', () => {
    /* The portal is UX. It must not offer something the API will refuse, or the role gets
       a link that always 403s — which is the v2 behaviour this replaces. */
    const NEEDS = {
      'kpi.dashboard': 'kpi.read',
      'lead.board': 'lead.read',
      'lead.detail': 'lead.read',
      'lead.hygiene': 'lead.read',
      'workorder.board': 'workorder.read',
      'workorder.detail': 'workorder.read',
      'install.board': 'install.read',
      'install.detail': 'install.read',
      'notification.list': 'notification.read',
      'platform.settings': 'settings.read',
    };
    for (const role of ALL_ROLES) {
      const held = permissionsFor(role);
      for (const screen of portalFor(role).screens) {
        const need = NEEDS[screen];
        if (!need) continue;
        expect({ role, screen, held: held.includes(need) })
          .toEqual({ role, screen, held: true });
      }
    }
  });
});

describe('GET /api/meta/me', () => {
  beforeAll(connect);
  afterAll(disconnect);
  beforeEach(clearCollections);

  it('carries the caller\'s portal, scope and direct reports', async () => {
    const { manager, execA, execB } = await roles.salesTeam('railways');

    const res = await request(app).get('/api/meta/me')
      .set('Authorization', `Bearer ${manager.token}`);

    expect(res.status).toBe(200);
    const me = res.body.data;
    expect(me.role).toBe('sales_manager');
    expect(me.domain).toBe('railways');
    expect(me.scope.mode).toBe('team');
    expect(me.scope.canSeeFinancials).toBe(true);
    expect(me.portal.key).toBe('sales-mgr');
    /* Every "Switch Exec ▼" picker and assignment dropdown renders from this. */
    expect(me.directReports.map((r) => String(r._id)).sort())
      .toEqual([execA.id, execB.id].map(String).sort());
  });

  it('tells a finance-blind role so, and gives it a portal with no lead screens', async () => {
    const engineer = await roles.asProductionEngineer();
    const res = await request(app).get('/api/meta/me')
      .set('Authorization', `Bearer ${engineer.token}`);

    expect(res.body.data.scope.canSeeFinancials).toBe(false);
    expect(res.body.data.scope.mode).toBe('own');
    expect(res.body.data.portal.screens).not.toContain('lead.board');
    expect(res.body.data.portal.landing).toBe('/prod-eng/orders');
  });

  it('is never cached', async () => {
    const exec = await roles.asSalesExecutive();
    const res = await request(app).get('/api/meta/me')
      .set('Authorization', `Bearer ${exec.token}`);
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/meta/me')).status).toBe(401);
  });
});

describe('pipeline cache invalidation', () => {
  it('no longer ships the per-user block inside the cached payload', async () => {
    await connect();
    await clearCollections();
    const exec = await roles.asSalesExecutive();
    const res = await request(app).get('/api/meta/pipeline')
      .set('Authorization', `Bearer ${exec.token}`);
    /* While `me` lived here it was cached with staleTime: Infinity keyed on `version`,
       so a permission change never reached an open tab. */
    expect(res.body.data.me).toBeUndefined();
    await disconnect();
  });

  it('hashes the role taxonomy into `version`', () => {
    const before = pipeline.serialize().version;
    const stage = pipeline.SALES_STAGES[0];
    const original = stage.ownerRole;
    stage.ownerRole = 'someone_else';
    const after = pipeline.serialize().version;
    stage.ownerRole = original;

    /* The payload carries ownerRole; if the hash ignores it, renaming a role changes what
       the endpoint sends and nothing about what already-signed-in clients believe. */
    expect(after).not.toBe(before);
    expect(pipeline.serialize().version).toBe(before);
  });
});
