'use strict';
/**
 * Pagination bounds — N-1.
 *
 * Regression for `?page=0` and `?page=-5`, which produced a negative Mongo skip
 * and answered **500** on every list endpoint. A query string a user can type
 * should never be a server error.
 *
 * Also pins the ceiling: `?limit=100000` previously loaded the whole collection.
 */
const request = require('supertest');
const app     = require('../src/app');
const Agent   = require('../src/models/Agent');
const { parsePaging, MAX_LIMIT, DEFAULT_LIMIT } = require('../src/utils/pagination');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');

const LIST_ROUTES = ['/api/agents', '/api/products', '/api/expos', '/api/leads'];

let adminToken;

beforeAll(connect);
afterAll(disconnect);
beforeEach(async () => {
  await clearCollections();
  adminToken = tok(await insertUser({ role: 'superadmin' }));
});

describe('parsePaging clamps every hostile input', () => {
  it.each([
    ['page=0',        { page: '0' },        1],
    ['negative page', { page: '-5' },       1],
    ['page=abc',      { page: 'abc' },      1],
    ['missing page',  {},                   1],
    ['page=2',        { page: '2' },        2],
  ])('%s → page %i', (_label, query, expected) => {
    expect(parsePaging(query).page).toBe(expected);
  });

  it('never produces a negative skip', () => {
    for (const page of ['0', '-1', '-999', 'abc', '']) {
      expect(parsePaging({ page }).skip).toBeGreaterThanOrEqual(0);
    }
  });

  it('caps limit at MAX_LIMIT', () => {
    expect(parsePaging({ limit: '100000' }).limit).toBe(MAX_LIMIT);
  });

  it('rejects a non-positive limit and falls back to the default', () => {
    expect(parsePaging({ limit: '0' }).limit).toBe(DEFAULT_LIMIT);
    expect(parsePaging({ limit: '-10' }).limit).toBe(DEFAULT_LIMIT);
    expect(parsePaging({ limit: 'abc' }).limit).toBe(DEFAULT_LIMIT);
  });

  it('honours a caller default but never above the ceiling', () => {
    expect(parsePaging({}, { defaultLimit: 500 }).limit).toBe(500);
    expect(parsePaging({ limit: '9999' }, { defaultLimit: 500 }).limit).toBe(MAX_LIMIT);
  });

  it('computes skip from the clamped values', () => {
    expect(parsePaging({ page: '3', limit: '10' })).toEqual({ page: 3, limit: 10, skip: 20 });
  });
});

describe('list endpoints survive hostile pagination', () => {
  it.each(LIST_ROUTES)('GET %s?page=0 → 200, not 500', async (route) => {
    const res = await request(app).get(`${route}?page=0`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it.each(LIST_ROUTES)('GET %s?page=-5 → 200, not 500', async (route) => {
    const res = await request(app).get(`${route}?page=-5`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it.each(LIST_ROUTES)('GET %s?limit=100000 is capped', async (route) => {
    const res = await request(app).get(`${route}?limit=100000`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBeLessThanOrEqual(MAX_LIMIT);
  });

  it('reports the clamped page back to the caller, not the raw input', async () => {
    const res = await request(app).get('/api/agents?page=0').set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.pagination.page).toBe(1);
  });

  it('paginates correctly across a real collection', async () => {
    await Agent.insertMany(Array.from({ length: 5 }, (_, i) => ({
      name: `Agent ${i}`, initials: `A${i}`, email: `a${i}@iinvsys.test`,
      phone: `90000000${i}`, territory: 'West',
    })));

    const p1 = await request(app).get('/api/agents?page=1&limit=2').set('Authorization', `Bearer ${adminToken}`);
    const p3 = await request(app).get('/api/agents?page=3&limit=2').set('Authorization', `Bearer ${adminToken}`);

    expect(p1.body.data).toHaveLength(2);
    expect(p3.body.data).toHaveLength(1);
    expect(p1.body.pagination.total).toBe(5);
    expect(p1.body.pagination.pages).toBe(3);

    const ids = new Set([...p1.body.data, ...p3.body.data].map((a) => a._id));
    expect(ids.size).toBe(3); // no overlap between pages
  });
});

describe('PUT is a partial update on every resource', () => {
  it('updating one agent field does not require the whole object', async () => {
    const agent = await Agent.create({
      name: 'Priya Nair', initials: 'PN', email: 'priya@iinvsys.test',
      phone: '9876543210', territory: 'West',
    });

    const res = await request(app)
      .put(`/api/agents/${agent._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ territory: 'Pune' });

    expect(res.status).toBe(200);
    expect(res.body.data.territory).toBe('Pune');
    expect(res.body.data.name).toBe('Priya Nair'); // untouched
  });

  it('still rejects a malformed value when the field IS supplied', async () => {
    const agent = await Agent.create({
      name: 'Priya Nair', initials: 'PN', email: 'priya2@iinvsys.test',
      phone: '9876543210', territory: 'West',
    });

    const res = await request(app)
      .put(`/api/agents/${agent._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(422);
  });
});
