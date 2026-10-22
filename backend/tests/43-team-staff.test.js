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
const { ALL_ROLES, scopeModeFor } = require('../src/config/permissions');

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

  describe('deactivate is reversible — not a one-way door', () => {
    /*
     * scope.userIds counts ACTIVE descendants, so reusing it for staff administration
     * meant a manager lost sight of anyone the moment they deactivated them: gone from
     * ?team=1, and every edit/restore 403. The button that promised "you can restore
     * them here" could not.
     */
    it('an ASM can still see, edit and restore an SE they deactivated', async () => {
      const o = await roles.salesOrg();
      const target = o.northA.execA.id;
      const asm = o.northA.manager;

      expect((await request(app).delete(`/api/users/${target}`).set(auth(asm.token))).status).toBe(200);
      expect((await User.findById(target).lean()).isActive).toBe(false);

      const listed = await request(app).get('/api/users?team=1&limit=100').set(auth(asm.token));
      expect(listed.body.data.map((u) => String(u._id))).toContain(String(target));

      const restored = await request(app).put(`/api/users/${target}`)
        .set(auth(asm.token)).send({ status: 'active' });
      expect(restored.status).toBe(200);
      expect((await User.findById(target).lean()).isActive).toBe(true);
    });

    it('a ZSM can restore someone two levels down, and still not reach another zone', async () => {
      const o = await roles.salesOrg();
      await request(app).delete(`/api/users/${o.northA.execA.id}`).set(auth(o.north.token));
      expect((await request(app).put(`/api/users/${o.northA.execA.id}`)
        .set(auth(o.north.token)).send({ status: 'active' })).status).toBe(200);

      await request(app).delete(`/api/users/${o.southA.execA.id}`).set(auth(o.director.token));
      expect((await request(app).put(`/api/users/${o.southA.execA.id}`)
        .set(auth(o.north.token)).send({ status: 'active' })).status).toBe(403);
    });

    it('a deactivated person cannot be made someone\'s manager', async () => {
      const o = await roles.salesOrg();
      await request(app).delete(`/api/users/${o.northB.manager.id}`).set(auth(o.north.token));
      const res = await request(app).patch(`/api/users/${o.northA.execA.id}/manager`)
        .set(auth(o.north.token)).send({ reportsTo: o.northB.manager.id });
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

      /* Still exactly the subtree after one of them is deactivated — see above. */
      await request(app).delete(`/api/users/${o.northA.execB.id}`).set(auth(o.northA.manager.token));
      expect(await list(o.northA.manager)).toEqual(
        [o.northA.manager.id, o.northA.execA.id, o.northA.execB.id].map(String).sort());

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
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * PRIVILEGE ESCALATION — a manager may not mint a company-wide reader.
   *
   * REPORTS_TO_ROLES only described the Sales chart, and `mayReportTo` returns true for
   * any role it does not list. Production Head, Installation Head and CS Manager were
   * unlisted and all three read company-wide (ROLE_SCOPE 'all'), so an ASM could create
   * one inside their own team, or promote one of their own executives into one, with a
   * single request that the chart rule waved through. Asserted here for every role whose
   * read scope is 'all' rather than for the three by name, so a future role added with
   * that scope fails this test instead of quietly reopening the hole.
   * ───────────────────────────────────────────────────────────────────────────
   */
  describe('a manager cannot appoint a company-wide role', () => {
    const COMPANY_WIDE = ALL_ROLES
      .filter((r) => scopeModeFor(r) === 'all' && r !== 'superadmin');

    it('the roles under test really are the company-wide ones', () => {
      expect(COMPANY_WIDE).toEqual(expect.arrayContaining(
        ['sales_director', 'production_head', 'install_head', 'cs_manager']));
    });

    it.each(COMPANY_WIDE)('an ASM cannot CREATE a %s inside their team', async (role) => {
      const o = await roles.salesOrg();
      const res = await create(o.northA.manager, person(role, o.northA.manager.id));
      expect([400, 403]).toContain(res.status);
      expect(await User.findOne({ role, chain: o.northA.manager.id }).lean()).toBeNull();
    });

    it.each(COMPANY_WIDE)('an ASM cannot PROMOTE their own SE to %s', async (role) => {
      const o = await roles.salesOrg();
      const res = await request(app).put(`/api/users/${o.northA.execA.id}`)
        .set(auth(o.northA.manager.token)).send({ role });
      expect([400, 403]).toContain(res.status);
      expect((await User.findById(o.northA.execA.id).lean()).role).toBe('sales_executive');
    });

    it('a ZSM cannot either, two levels down', async () => {
      const o = await roles.salesOrg();
      const res = await request(app).put(`/api/users/${o.northA.execB.id}`)
        .set(auth(o.north.token)).send({ role: 'production_head' });
      expect([400, 403]).toContain(res.status);
    });

    it('the Director still may — building the chart is their job', async () => {
      const o = await roles.salesOrg();
      const res = await create(o.director, person('production_head', null));
      expect(res.status).toBe(201);
    });
  });

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE PLATFORM ACCOUNT IS NOT STAFF.
   *
   * The Director's staff reach is company-wide so they can build the org chart, and
   * nothing excluded `superadmin` from it. A greenfield deployment has exactly ONE
   * superadmin, so `DELETE /api/users/:id` or `PUT {role:'sales_executive'}` on it
   * locked every administrator out of the system with no route back through the app.
   * Creating and granting superadmin were already refused; changing and removing an
   * existing one were not.
   * ───────────────────────────────────────────────────────────────────────────
   */
  describe('the superadmin account', () => {
    const everyoneElse = async () => {
      const admin = await roles.asSuperadmin();
      const o = await roles.salesOrg();
      const prodHead = await roles.asProductionHead();
      return { admin, actors: [o.director, o.north, o.northA.manager, prodHead] };
    };

    it('cannot be deactivated by anyone but a superadmin', async () => {
      const { admin, actors } = await everyoneElse();
      for (const actor of actors) {
        const res = await request(app).delete(`/api/users/${admin.id}`).set(auth(actor.token));
        expect([403, 400]).toContain(res.status);
      }
      expect((await User.findById(admin.id).lean()).isActive).toBe(true);
    });

    it('cannot be demoted or renamed by anyone but a superadmin', async () => {
      const { admin, actors } = await everyoneElse();
      for (const actor of actors) {
        expect([403, 400]).toContain((await request(app).put(`/api/users/${admin.id}`)
          .set(auth(actor.token)).send({ role: 'sales_executive' })).status);
        expect([403, 400]).toContain((await request(app).put(`/api/users/${admin.id}`)
          .set(auth(actor.token)).send({ email: 'hijack@iinvsys.test' })).status);
      }
      const after = await User.findById(admin.id).lean();
      expect(after.role).toBe('superadmin');
      expect(after.email).not.toBe('hijack@iinvsys.test');
    });

    it('cannot have its reporting line moved by the Director', async () => {
      const { admin } = await everyoneElse();
      const o = await roles.salesOrg();
      const res = await request(app).patch(`/api/users/${admin.id}/manager`)
        .set(auth(o.director.token)).send({ reportsTo: o.director.id });
      expect([403, 400]).toContain(res.status);
    });

    it('a superadmin may still administer another superadmin', async () => {
      const a = await roles.asSuperadmin();
      const b = await roles.asSuperadmin();
      expect((await request(app).put(`/api/users/${b.id}`)
        .set(auth(a.token)).send({ name: 'Renamed' })).status).toBe(200);
      expect((await request(app).delete(`/api/users/${b.id}`).set(auth(a.token))).status).toBe(200);
    });
  });

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * EVERY MANAGER STAFFS THEIR OWN TEAM — not just the Sales ones.
   *
   * Production Head, Installation Head and CS Manager held no `user.write` at all, so
   * the three roles that doc 3 and doc 4 describe as running a team of their own could
   * not add, edit or remove one person; every hire went through the superadmin.
   *
   * Their READ scope is 'all', which is why the controller decides staff reach from
   * `staffWriteMode(role)` and not from `req.scope`: granted `user.write` against the
   * read scope they would each have become a company-wide staff administrator, which is
   * the opposite of the rule. Both halves are asserted — what they may do, and the
   * neighbouring team they still may not touch.
   * ───────────────────────────────────────────────────────────────────────────
   */
  describe('the non-Sales module heads', () => {
    const MODULES = [
      ['production_head',  'production_engineer', roles.asProductionHead],
      ['install_head',     'field_engineer',      roles.asInstallHead],
      ['cs_manager',       'cs_agent',            roles.asCSManager],
    ];

    it.each(MODULES)('a %s adds, edits and deactivates their own %s', async (_h, memberRole, asHead) => {
      const head = await asHead();
      const made = await create(head, person(memberRole, head.id));
      expect(made.status).toBe(201);
      const id = made.body.data._id;

      expect((await request(app).put(`/api/users/${id}`)
        .set(auth(head.token)).send({ territory: 'Bay 4' })).status).toBe(200);
      expect((await request(app).delete(`/api/users/${id}`).set(auth(head.token))).status).toBe(200);
      expect((await User.findById(id).lean()).isActive).toBe(false);
      /* And back again — the same Restore every other manager has. */
      expect((await request(app).put(`/api/users/${id}`)
        .set(auth(head.token)).send({ status: 'active' })).status).toBe(200);
    });

    it.each(MODULES)('a %s cannot touch anyone outside their own subtree', async (_h, _m, asHead) => {
      const head = await asHead();
      const o = await roles.salesOrg();
      const other = await roles.asProductionEngineer();   /* unplaced: nobody's report */

      for (const outsider of [o.director.id, o.northA.execA.id, other.id]) {
        expect((await request(app).put(`/api/users/${outsider}`)
          .set(auth(head.token)).send({ territory: 'x' })).status).toBe(403);
        expect((await request(app).delete(`/api/users/${outsider}`)
          .set(auth(head.token))).status).toBe(403);
      }
    });

    it.each(MODULES)('a %s gets their own subtree from ?team=1, not the company', async (_h, memberRole, asHead) => {
      const head = await asHead();
      const mine = await roles.make(memberRole, { reportsTo: head.id });
      const o = await roles.salesOrg();

      const res = await request(app).get('/api/users?team=1&limit=100').set(auth(head.token));
      expect(res.status).toBe(200);
      const ids = res.body.data.map((u) => String(u._id));
      expect(ids.sort()).toEqual([head.id, mine.id].map(String).sort());
      expect(ids).not.toContain(String(o.director.id));
    });

    it('the chart rule still applies: a Production Head cannot add a field engineer', async () => {
      const head = await roles.asProductionHead();
      const res = await create(head, person('field_engineer', head.id));
      expect([400, 403]).toContain(res.status);
    });

    it('/meta/me reports the staff-write axis separately from the read scope', async () => {
      const head = await roles.asProductionHead();
      const me = await request(app).get('/api/meta/me').set(auth(head.token));
      expect(me.body.data.scope.mode).toBe('all');
      expect(me.body.data.scope.staffWrite).toBe('team');

      const o = await roles.salesOrg();
      const dir = await request(app).get('/api/meta/me').set(auth(o.director.token));
      expect(dir.body.data.scope.staffWrite).toBe('all');
    });
  });
});
