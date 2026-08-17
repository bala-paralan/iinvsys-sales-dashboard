'use strict';
/**
 * GET /api/meta/* — first coverage.
 *
 * This endpoint is the load-bearing contract of the whole frontend rebuild:
 * per docs/requirements/10-frontend-architecture.md the client renders stage
 * columns, gate checklists, enum dropdowns and KPI targets FROM THIS PAYLOAD and
 * never from hardcoded tables. A silent shape change here breaks every screen at
 * once, so the shape is pinned.
 */
const request  = require('supertest');
const app      = require('../src/app');
const pipeline = require('../src/config/pipeline');
const runtime  = require('../src/config/pipelineRuntime');
const { ALL_ROLES, permissionsFor } = require('../src/config/permissions');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');

let tokens = {};

beforeAll(connect);
afterAll(disconnect);
beforeEach(async () => {
  await clearCollections();
  runtime.resetRules();
  tokens = {};
  for (const role of ['superadmin', 'manager', 'agent', 'readonly', 'referrer', 'warehouse']) {
    tokens[role] = tok(await insertUser({ role }));
  }
});
afterAll(() => runtime.resetRules());

const get = (path, role) =>
  request(app).get(path).set('Authorization', `Bearer ${tokens[role]}`);

describe('GET /api/meta/pipeline — access', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/meta/pipeline')).status).toBe(401);
  });

  it.each(ALL_ROLES.filter((r) => !['sales_director', 'finance', 'delivery_manager',
    'logistics', 'installation_manager', 'technician', 'cs_executive'].includes(r)))(
    'is readable by %s — every role needs stage labels to render anything', async (role) => {
      expect((await get('/api/meta/pipeline', role)).status).toBe(200);
    });

  it('is readable by a referrer and by an operational role', async () => {
    expect((await get('/api/meta/pipeline', 'referrer')).status).toBe(200);
    expect((await get('/api/meta/pipeline', 'warehouse')).status).toBe(200);
  });
});

describe('GET /api/meta/pipeline — payload shape', () => {
  let body;
  beforeEach(async () => { body = (await get('/api/meta/pipeline', 'manager')).body.data; });

  it('carries a version matching the active rules', () => {
    expect(body.version).toBe(pipeline.pipelineVersion(pipeline.getActiveRules()));
  });

  it('exposes all three processes', () => {
    expect(body.sales.stages.length).toBe(pipeline.SALES_STAGES.length);
    expect(body.delivery.stages.length).toBe(pipeline.DELIVERY_STAGES.length);
    expect(body.installation.stages.length).toBe(pipeline.INSTALL_STAGES.length);
  });

  it('names the won and lost sales stages explicitly', () => {
    expect(body.sales.won).toBe('commercial_order');
    expect(body.sales.lost).toBe('order_lost');
    expect(body.sales.terminal).toEqual(expect.arrayContaining(['commercial_order', 'order_lost']));
  });

  it('gives every stage what a kanban column needs', () => {
    for (const s of body.sales.stages) {
      expect(s).toMatchObject({
        key: expect.any(String), label: expect.any(String),
        order: expect.any(Number), color: expect.any(String),
      });
      expect(Array.isArray(s.entryRequires)).toBe(true);
    }
  });

  it('gives every gate row the triple the checklist UI renders', () => {
    const rows = body.sales.stages.flatMap((s) => s.entryRequires);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(typeof r.field).toBe('string');
      expect(typeof r.test).toBe('string');
      expect(typeof r.message).toBe('string');
    }
  });

  it('ships the install checklist templates the stage runner needs', () => {
    const planning = body.installation.stages.find((s) => s.key === 'planning');
    expect(Array.isArray(planning.checklistTemplate)).toBe(true);
    expect(planning.checklistTemplate.length).toBeGreaterThan(0);
  });

  it('ships every enum the client would otherwise hardcode', () => {
    for (const key of ['leadSources', 'companyTypes', 'industrySegments', 'zones',
      'competitors', 'lostReasons', 'lostTo', 'docTypes', 'delayReasonCodes']) {
      expect(Array.isArray(body.enums[key])).toBe(true);
      expect(body.enums[key].length).toBeGreaterThan(0);
      expect(body.enums[key][0]).toMatchObject({ key: expect.any(String), label: expect.any(String) });
    }
  });

  it('ships the SPENCO dimensions and the active threshold', () => {
    expect(body.spenco.dimensions).toHaveLength(6);
    expect(body.spenco.maxTotal).toBe(30);
    expect(body.spenco.minTotal).toBe(pipeline.DEFAULT_RULES.spencoMinTotal);
  });

  it('ships KPI targets so no dashboard hardcodes one', () => {
    expect(Object.keys(body.kpiTargets).length).toBeGreaterThan(0);
  });

  it('never leaks a raw pipeline internal — entryRequires rows carry no configKey', () => {
    const rows = body.sales.stages.flatMap((s) => s.entryRequires);
    expect(rows.some((r) => 'configKey' in r)).toBe(false);
  });
});

describe('GET /api/meta/pipeline — reflects the caller and the active rules', () => {
  it('reports the caller’s own role and permissions', async () => {
    const body = (await get('/api/meta/pipeline', 'warehouse')).body.data;
    expect(body.me.role).toBe('warehouse');
    expect(body.me.permissions).toEqual(permissionsFor('warehouse'));
  });

  it('gives a referrer an empty permission set', async () => {
    const body = (await get('/api/meta/pipeline', 'referrer')).body.data;
    expect(body.me.permissions).toEqual([]);
  });

  it('a rule change moves the version AND the payload', async () => {
    const before = (await get('/api/meta/pipeline', 'manager')).body.data;

    pipeline.setActiveRules({ spencoMinTotal: 24, competitorRequiredFromStage: 'prospect' });
    const after = (await get('/api/meta/pipeline', 'manager')).body.data;

    expect(after.version).not.toBe(before.version);
    expect(after.spenco.minTotal).toBe(24);
    expect(after.sales.stages.find((s) => s.key === 'prospect')
      .entryRequires.some((r) => r.field === 'competitor')).toBe(true);
  });

  it('is not cached at all — `private` was not enough', async () => {
    const res = await get('/api/meta/pipeline', 'manager');
    /* This test previously asserted `private`, which is what the code did and
       what I wrote it to confirm — and both were wrong. `private` only stops
       SHARED caches; the browser's own cache still keys on the URL alone and
       does not include Authorization, so the next user to sign in on the same
       machine got the previous user's `me.permissions` for five minutes. */
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /api/meta/permissions', () => {
  it('requires manager or above', async () => {
    expect((await get('/api/meta/permissions', 'agent')).status).toBe(403);
    expect((await get('/api/meta/permissions', 'readonly')).status).toBe(403);
    expect((await get('/api/meta/permissions', 'referrer')).status).toBe(403);
  });

  it('returns the full matrix to a manager', async () => {
    const res = await get('/api/meta/permissions', 'manager');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data.roles).sort()).toEqual([...ALL_ROLES].sort());
  });
});

describe('GET /api/meta/pipeline caching', () => {
  it('is never stored by the HTTP cache — the payload is user-specific', async () => {
    const token = tok(await insertUser({ role: 'manager', name: 'Sneha' }));
    const res = await request(app).get('/api/meta/pipeline')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    /* It was `private, max-age=300`. The browser caches by URL and does not
       include Authorization in the cache key, so the next user to sign in on
       the same machine rendered the PREVIOUS user's permissions for five
       minutes — on a shared expo laptop, the normal case. */
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['cache-control']).not.toMatch(/max-age=[1-9]/);
    expect(res.headers.vary).toMatch(/Authorization/i);
  });

  it('reports the CALLER as me, for each role', async () => {
    const roles = ['superadmin', 'manager', 'agent', 'technician'];
    for (const role of roles) {
      const res = await request(app).get('/api/meta/pipeline')
        .set('Authorization', `Bearer ${tok(await insertUser({ role }))}`);
      expect(res.body.data.me.role).toBe(role);
    }
  });
});
