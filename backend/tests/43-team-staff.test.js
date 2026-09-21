'use strict';

/**
 * SPENCO CRM brief §3 — who may add and manage people.
 *
 * The Director has "full access to the entire system"; a manager "manages their team".
 * ISM, ZSM and ASM hold `user.write` exactly as the Director does, and the difference is
 * SCOPE: a manager grows, edits, moves and deactivates their own subtree and nothing
 * outside it. Every rule is asserted in both directions — a boundary proven only by its
 * refusals is indistinguishable from one that refuses everyone.
 */

const request = require('supertest');
const app = require('../src/app');
const User = require('../src/models/User');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const roles = require('./helpers/roles');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
let n = 0;
const person = (role, reportsTo, extra = {}) => ({
  name: `New ${role} ${++n}`, email: `new.${role}.${n}@iinvsys.test`, password: 'TestPass@123',
  role, reportsTo, ...extra,
});
const create = (actor, body) => request(app).post('/api/users').set(auth(actor.token)).send(body);

describe('team-scoped staff management — SPENCO CRM brief §3', () => {
  beforeAll(connect);
  afterAll(disconnect);
  beforeEach(clearCollections);

  describe('creating people', () => {
    it('an ASM adds an SE under themselves', async () => {
      const o = await roles.salesOrg();
      const res = await create(o.northA.manager, person('sales_executive', o.northA.manager.id));
      expect(res.status).toBe(201);
      const u = await User.findById(res.body.data._id).lean();
      expect(String(u.reportsTo)).toBe(String(o.northA.manager.id));
      expect(u.chain.map(String)).toContain(String(o.north.id));   // placed in the chart
    });

    it('a ZSM adds an ASM under themselves, and an SE under one of their ASMs', async () => {
      const o = await roles.salesOrg();
      expect((await create(o.north, person('area_sales_manager', o.north.id, { zone: 'north' }))).status).toBe(201);
      expect((await create(o.north, person('sales_executive', o.northA.manager.id))).status).toBe(201);
    });

    it('an ISM adds an ISE under themselves', async () => {
      const o = await roles.salesOrg();
      expect((await create(o.ism, person('inside_sales_executive', o.ism.id))).status).toBe(201);
    });

    it('a manager cannot add someone into ANOTHER team', async () => {
      const o = await roles.salesOrg();
      /* ASM → the other ASM's team; ZSM → the other zone. */
      expect((await create(o.northA.manager, person('sales_executive', o.northB.manager.id))).status).toBe(403);
      expect((await create(o.north, person('sales_executive', o.southA.manager.id))).status).toBe(403);
      expect((await create(o.north, person('area_sales_manager', o.south.id))).status).toBe(403);
    });

    it('a manager cannot add an unplaced person — reportsTo is required for them', async () => {
      const o = await roles.salesOrg();
      const res = await create(o.northA.manager, person('sales_executive', undefined));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/report to you/i);
    });

    it('the chart rule still applies: an ASM cannot add a ZSM or an ASM under themselves', async () => {
      const o = await roles.salesOrg();
      const zsm = await create(o.northA.manager, person('zonal_sales_manager', o.northA.manager.id));
      expect(zsm.status).toBe(400);
      expect(zsm.body.message).toMatch(/cannot report to/i);
      expect((await create(o.northA.manager, person('area_sales_manager', o.northA.manager.id))).status).toBe(400);
    });

    it('the Director adds anyone anywhere; nobody but a superadmin mints a superadmin', async () => {
      const o = await roles.salesOrg();
      expect((await create(o.director, person('sales_executive', o.southA.manager.id))).status).toBe(201);
      expect((await create(o.director, person('zonal_sales_manager', o.director.id, { zone: 'east' }))).status).toBe(201);
      expect((await create(o.director, person('production_head', undefined))).status).toBe(201);
      const sa = await create(o.director, person('superadmin', undefined));
      expect(sa.status).toBe(403);
      const root = await roles.asSuperadmin();
      expect((await create(root, person('superadmin', undefined))).status).toBe(201);
    });

    it('an executive cannot create people at all', async () => {
      const o = await roles.salesOrg();
      expect((await create(o.northA.execA, person('sales_executive', o.northA.manager.id))).status).toBe(403);
      expect((await create(o.ise, person('inside_sales_executive', o.ism.id))).status).toBe(403);
    });
  });

  describe('editing, moving, deactivating', () => {
    it('an ASM edits and deactivates their own SE, not another ASM\'s', async () => {
      const o = await roles.salesOrg();
      const mine = await request(app).put(`/api/users/${o.northA.execA.id}`)
        .set(auth(o.northA.manager.token)).send({ target: 250000 });
      expect(mine.status).toBe(200);
      expect(mine.body.data.target).toBe(250000);

      const theirs = await request(app).put(`/api/users/${o.northB.execA.id}`)
        .set(auth(o.northA.manager.token)).send({ target: 1 });
      expect(theirs.status).toBe(403);

      expect((await request(app).delete(`/api/users/${o.northB.execA.id}`).set(auth(o.northA.manager.token))).status).toBe(403);
      expect((await request(app).delete(`/api/users/${o.northA.execA.id}`).set(auth(o.northA.manager.token))).status).toBe(200);
      expect((await User.findById(o.northA.execA.id).lean()).isActive).toBe(false);
    });

    it('a manager cannot edit their own record through the staff form', async () => {
      const o = await roles.salesOrg();
      const res = await request(app).put(`/api/users/${o.northA.manager.id}`)
        .set(auth(o.northA.manager.token)).send({ target: 1 });
      expect(res.status).toBe(403);
    });

    it('a ZSM moves an SE between their own ASMs, but not out of the zone or to nobody', async () => {
      const o = await roles.salesOrg();
      const move = (to) => request(app).patch(`/api/users/${o.northA.execA.id}/manager`)
        .set(auth(o.north.token)).send({ reportsTo: to });
      expect((await move(o.northB.manager.id)).status).toBe(200);
      expect(String((await User.findById(o.northA.execA.id).lean()).reportsTo)).toBe(String(o.northB.manager.id));
      expect((await move(o.southA.manager.id)).status).toBe(403);
      expect((await move(null)).status).toBe(403);
      /* The Director may do both. */
      const asDirector = (to) => request(app).patch(`/api/users/${o.northA.execA.id}/manager`)
        .set(auth(o.director.token)).send({ reportsTo: to });
      expect((await asDirector(o.southA.manager.id)).status).toBe(200);
      expect((await asDirector(null)).status).toBe(200);
    });

    it('a ZSM cannot touch someone in the other zone, even via a valid-looking manager', async () => {
      const o = await roles.salesOrg();
      const res = await request(app).patch(`/api/users/${o.southA.execA.id}/manager`)
        .set(auth(o.north.token)).send({ reportsTo: o.northA.manager.id });
      expect(res.status).toBe(403);
    });
  });

  describe('the staff list', () => {
    it('?team=1 returns exactly the caller\'s subtree, self included; the Director gets everyone', async () => {
      const o = await roles.salesOrg();
      const list = (actor) => request(app).get('/api/users?team=1&limit=100').set(auth(actor.token))
        .then((r) => r.body.data.map((u) => String(u._id)).sort());

      const asm = await list(o.northA.manager);
      expect(asm).toEqual([o.northA.manager.id, o.northA.execA.id, o.northA.execB.id].map(String).sort());

      const zsm = await list(o.north);
      expect(zsm).toContain(String(o.northB.execB.id));
      expect(zsm).not.toContain(String(o.southA.execA.id));
      expect(zsm).not.toContain(String(o.director.id));

      const all = await list(o.director);
      expect(all).toContain(String(o.southA.execA.id));
      expect(all).toContain(String(o.ise.id));
    });

    it('without ?team the directory stays company-wide for every internal role', async () => {
      const o = await roles.salesOrg();
      const res = await request(app).get('/api/users?limit=100').set(auth(o.northA.manager.token));
      expect(res.status).toBe(200);
      expect(res.body.data.map((u) => String(u._id))).toContain(String(o.southA.execA.id));
    });
  });
});
