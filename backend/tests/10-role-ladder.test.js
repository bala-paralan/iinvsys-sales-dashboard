'use strict';
/**
 * The role ladder — regression for a live authorisation hole.
 *
 * `ROLE_LEVEL` previously put `referrer`, `readonly` and all seven operational
 * roles at level 1. Because `requireMinRole` tests `>=`, that made
 * `requireMinRole('readonly')` admit EVERY authenticated user — including
 * referrers, whose credentials are generated in bulk and handed out at expos.
 *
 * Exposed by it: the full agent directory (names, emails, phones, territories,
 * targets), the product catalogue with prices, every expo, and system settings.
 *
 * These tests assert the ladder by behaviour through the HTTP layer, not by
 * reading the constant, so re-introducing the bug fails here regardless of how
 * the levels are spelled.
 */
const request = require('supertest');
const app     = require('../src/app');

const Expo    = require('../src/models/Expo');
const Agent   = require('../src/models/Agent');
const Product = require('../src/models/Product');
const { ROLE_LEVEL } = require('../src/middleware/rbac');
const { OPERATIONAL_ROLES } = require('../src/config/permissions');
const { connect, disconnect, clearCollections } = require('./helpers/db');
/* insertUser writes a placeholder hash directly through the driver. These tests
   authenticate with a signed token and never call comparePassword, so paying
   bcrypt cost 12 for a dozen users in every beforeEach would add minutes to the
   suite for nothing. */
const { insertUser, tok } = require('./helpers/testUtils');

/** Routes guarded by requireMinRole('readonly') — "any internal viewer". */
const INTERNAL_READ_ROUTES = [
  '/api/agents',
  '/api/products',
  '/api/settings',
];

/* `sales_director` is in OPERATIONAL_ROLES but is NOT outside the ladder — it is
   a deliberate escalation of `manager` (final authority on discount and term
   deviations), so it sits at level 3 and keeps full internal read.
   See docs/requirements/04-roles-and-permissions.md. */
const OUTSIDE_LADDER = OPERATIONAL_ROLES.filter((r) => r !== 'sales_director');

let expoA, expoB;
const tokens = {};

async function makeUser(role, extra = {}) {
  return tok(await insertUser({ role, email: `${role}@iinvsys.test`, ...extra }));
}

beforeAll(connect);
afterAll(disconnect);

beforeEach(async () => {
  await clearCollections();

  expoA = await Expo.create({
    name: 'Mumbai Expo', startDate: new Date(), endDate: new Date(Date.now() + 86400000),
    venue: 'BEC', city: 'Mumbai',
  });
  expoB = await Expo.create({
    name: 'Delhi Expo', startDate: new Date(), endDate: new Date(Date.now() + 86400000),
    venue: 'Pragati', city: 'Delhi',
  });

  await Agent.create({
    name: 'Priya Nair', initials: 'PN', email: 'priya@iinvsys.test',
    phone: '9876543210', territory: 'West',
  });
  await Product.create({ name: 'Smart Gateway', sku: 'SG-1', category: 'hardware', price: 25000 });

  for (const role of ['superadmin', 'manager', 'agent', 'readonly', ...OPERATIONAL_ROLES]) {
    tokens[role] = await makeUser(role);
  }
  tokens.referrer = await makeUser('referrer', { expoId: expoA._id, isTemporary: true });
});

describe('the ladder places only readonly and above inside internal data', () => {
  it('readonly is the internal-viewer floor', () => {
    expect(ROLE_LEVEL.readonly).toBe(1);
  });

  it.each(['referrer', ...OUTSIDE_LADDER])('%s sits below readonly', (role) => {
    expect(ROLE_LEVEL[role]).toBeLessThan(ROLE_LEVEL.readonly);
  });

  it('sales_director is an escalation of manager, not an outsider', () => {
    expect(ROLE_LEVEL.sales_director).toBe(ROLE_LEVEL.manager);
  });
});

describe('referrers cannot read internal collections', () => {
  it.each(INTERNAL_READ_ROUTES)('GET %s → 403 for a referrer', async (route) => {
    const res = await request(app).get(route).set('Authorization', `Bearer ${tokens.referrer}`);
    expect(res.status).toBe(403);
  });

  it('the agent directory does not leak staff contact details', async () => {
    const res = await request(app).get('/api/agents').set('Authorization', `Bearer ${tokens.referrer}`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('priya@iinvsys.test');
  });

  it('the product catalogue does not leak prices', async () => {
    const res = await request(app).get('/api/products').set('Authorization', `Bearer ${tokens.referrer}`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('25000');
  });
});

describe('operational roles cannot read the sales pipeline or internal collections', () => {
  it.each(OUTSIDE_LADDER)('%s is refused the internal read routes', async (role) => {
    for (const route of INTERNAL_READ_ROUTES) {
      const res = await request(app).get(route).set('Authorization', `Bearer ${tokens[role]}`);
      expect([403]).toContain(res.status);
    }
  });

  it.each(OUTSIDE_LADDER)('%s is refused GET /api/leads', async (role) => {
    const res = await request(app).get('/api/leads').set('Authorization', `Bearer ${tokens[role]}`);
    expect(res.status).toBe(403);
  });
});

describe('internal viewers keep the access they are supposed to have', () => {
  it.each(['readonly', 'agent', 'manager', 'sales_director', 'superadmin'])('%s can read the internal routes', async (role) => {
    for (const route of INTERNAL_READ_ROUTES) {
      const res = await request(app).get(route).set('Authorization', `Bearer ${tokens[role]}`);
      expect(res.status).toBe(200);
    }
  });
});

describe('the referrer expo path still works, but scoped', () => {
  it('GET /api/expos returns only the referrer’s own expo', async () => {
    const res = await request(app).get('/api/expos').set('Authorization', `Bearer ${tokens.referrer}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(String(res.body.data[0]._id)).toBe(String(expoA._id));
  });

  it('a referrer cannot widen the scope through the query string', async () => {
    const res = await request(app)
      .get(`/api/expos?city=Delhi&limit=100`)
      .set('Authorization', `Bearer ${tokens.referrer}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((e) => String(e._id) === String(expoA._id))).toBe(true);
  });

  it('GET /api/expos/:id succeeds for their own expo', async () => {
    const res = await request(app)
      .get(`/api/expos/${expoA._id}`).set('Authorization', `Bearer ${tokens.referrer}`);
    expect(res.status).toBe(200);
    expect(String(res.body.data._id)).toBe(String(expoA._id));
  });

  it('GET /api/expos/:id answers 404 for someone else’s expo, not 403', async () => {
    const res = await request(app)
      .get(`/api/expos/${expoB._id}`).set('Authorization', `Bearer ${tokens.referrer}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Delhi Expo');
  });

  it('internal viewers still see every expo', async () => {
    const res = await request(app).get('/api/expos').set('Authorization', `Bearer ${tokens.readonly}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('an operational role gets no expo access at all', async () => {
    const res = await request(app).get('/api/expos').set('Authorization', `Bearer ${tokens.warehouse}`);
    expect(res.status).toBe(403);
  });

  it('referrers still cannot enumerate or create referrer accounts', async () => {
    const list = await request(app)
      .get(`/api/expos/${expoA._id}/referrers`).set('Authorization', `Bearer ${tokens.referrer}`);
    expect(list.status).toBe(403);

    const create = await request(app)
      .post(`/api/expos/${expoA._id}/referrers`)
      .set('Authorization', `Bearer ${tokens.referrer}`)
      .send({ name: 'Mallory' });
    expect(create.status).toBe(403);
  });
});
