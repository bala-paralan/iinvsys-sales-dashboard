'use strict';
/**
 * The reporting hierarchy and row-level visibility.
 *
 * The headline requirement of ERP Bible V3, stated twice in doc 2:
 *   SA-DIR-01 note 1 — "Sales Manager 1 cannot see that Sales Manager 2 is at only 44%
 *                       of target."
 *   SA-MGR-01       — "You are viewing the Railways domain team only."
 *
 * Asserted THROUGH HTTP, not by calling the resolver, because the resolver being correct
 * and the controller using it are two different facts and only the second one matters.
 */
const request = require('supertest');
const app = require('../src/app');
const Lead = require('../src/models/Lead');
const User = require('../src/models/User');
const orgService = require('../src/services/orgService');
const { resolveScope, scopeAllows } = require('../src/services/scopeService');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const roles = require('./helpers/roles');

async function leadFor(ownerId, name) {
  return Lead.create({
    name, phone: '9100000000', source: 'referral', stage: 'suspect', owner: ownerId,
  });
}

describe('scope resolver', () => {
  beforeAll(connect);
  afterAll(disconnect);
  beforeEach(clearCollections);

  describe('org chart maintenance', () => {
    it('materialises the ancestor chain root-first', async () => {
      const director = await roles.asDirector();
      const manager = await roles.asSalesManager({ reportsTo: director.id });
      const exec = await roles.asSalesExecutive({ reportsTo: manager.id });

      const row = await User.findById(exec.id).lean();
      expect(row.chain.map(String)).toEqual([String(director.id), String(manager.id)]);
    });

    it('rewrites the whole subtree when a reporting line moves', async () => {
      const d1 = await roles.asDirector();
      const d2 = await roles.asDirector();
      const manager = await roles.asSalesManager({ reportsTo: d1.id });
      const exec = await roles.asSalesExecutive({ reportsTo: manager.id });

      await orgService.setManager(manager.id, d2.id);

      /* The executive never moved, but their ancestry did. If the subtree is not
         repaired, d2's team query silently misses everyone below the manager. */
      const row = await User.findById(exec.id).lean();
      expect(row.chain.map(String)).toEqual([String(d2.id), String(manager.id)]);

      /* Asserted through orgService rather than resolveScope: a Director is 'all'-scoped
         and would answer `userIds: null` whether or not the subtree was repaired, so the
         scope call cannot see this bug. */
      const beneath = await orgService.descendantIds(d2.id);
      expect(beneath.map(String)).toEqual(
        expect.arrayContaining([String(manager.id), String(exec.id)]),
      );
      expect((await orgService.descendantIds(d1.id)).map(String)).toEqual([]);
    });

    it('refuses a cycle', async () => {
      const manager = await roles.asSalesManager();
      const exec = await roles.asSalesExecutive({ reportsTo: manager.id });

      await expect(orgService.setManager(manager.id, exec.id))
        .rejects.toMatchObject({ code: 'ORG_CYCLE' });
      await expect(orgService.setManager(manager.id, manager.id))
        .rejects.toMatchObject({ code: 'ORG_CYCLE' });
    });
  });

  describe('scope modes', () => {
    it('gives a Sales Executive their own rows only', async () => {
      const { manager, execA } = await roles.salesTeam();
      const scope = await resolveScope(await User.findById(execA.id));
      expect(scope.mode).toBe('own');
      expect(scope.userIds.map(String)).toEqual([String(execA.id)]);
      expect(scope.userIds.map(String)).not.toContain(String(manager.id));
    });

    it('gives a Sales Manager themselves plus their reports', async () => {
      const { manager, execA, execB } = await roles.salesTeam();
      const scope = await resolveScope(await User.findById(manager.id));
      expect(scope.mode).toBe('team');
      expect(scope.userIds.map(String).sort())
        .toEqual([manager.id, execA.id, execB.id].map(String).sort());
    });

    it('gives a Director no row restriction at all', async () => {
      const director = await roles.asDirector();
      const scope = await resolveScope(await User.findById(director.id));
      expect(scope.mode).toBe('all');
      /* null, NOT an empty array. "No restriction" and "restricted to nobody" are
         opposites, and conflating them turns a scope bug into a company-wide leak. */
      expect(scope.userIds).toBeNull();
    });

    it('confines Inside Sales roles to the inside_sales track', async () => {
      const head = await resolveScope(await User.findById((await roles.asISHead()).id));
      const exec = await resolveScope(await User.findById((await roles.asISExec()).id));
      expect(head.tracks).toEqual(['inside_sales']);
      expect(exec.tracks).toEqual(['inside_sales']);

      const salesExec = await resolveScope(await User.findById((await roles.asSalesExecutive()).id));
      expect(salesExec.tracks).toBeNull();
    });
  });

  describe('scopeAllows accepts an id or a populated document', () => {
    it('unwraps a populated owner', async () => {
      const { manager, execA } = await roles.salesTeam();
      const scope = await resolveScope(await User.findById(manager.id));
      const populated = await User.findById(execA.id).select('name role').lean();

      expect(scopeAllows(scope, execA.id)).toBe(true);
      /* The same person, handed over as the document a controller populated for display.
         Without the unwrapping this is false, and the OWNER is refused their own row. */
      expect(scopeAllows(scope, populated)).toBe(true);
    });

    it('refuses an owner outside the scope, either way round', async () => {
      const { manager } = await roles.salesTeam('railways');
      const outsider = await roles.asSalesExecutive({ domain: 'defence' });
      const scope = await resolveScope(await User.findById(manager.id));
      const populated = await User.findById(outsider.id).select('name').lean();

      expect(scopeAllows(scope, outsider.id)).toBe(false);
      expect(scopeAllows(scope, populated)).toBe(false);
    });

    it('is unrestricted for an "all" scope', async () => {
      const director = await roles.asDirector();
      const scope = await resolveScope(await User.findById(director.id));
      expect(scopeAllows(scope, null)).toBe(true);
    });
  });

  describe('through HTTP — GET /api/leads', () => {
    it('Manager 1 cannot see Manager 2\'s team', async () => {
      const railways = await roles.salesTeam('railways');
      const defence  = await roles.salesTeam('defence');

      await leadFor(railways.execA.id, 'Railways deal');
      await leadFor(defence.execA.id, 'Defence deal');

      const res = await request(app).get('/api/leads')
        .set('Authorization', `Bearer ${railways.manager.token}`);

      expect(res.status).toBe(200);
      const names = res.body.data.map((l) => l.name);
      expect(names).toContain('Railways deal');
      expect(names).not.toContain('Defence deal');
    });

    it('an executive sees neither their peer nor their manager', async () => {
      const { manager, execA, execB } = await roles.salesTeam();
      await leadFor(execA.id, 'Mine');
      await leadFor(execB.id, 'My peer\'s');
      await leadFor(manager.id, 'My manager\'s');

      const res = await request(app).get('/api/leads')
        .set('Authorization', `Bearer ${execA.token}`);

      expect(res.body.data.map((l) => l.name)).toEqual(['Mine']);
    });

    it('a ?owner= outside the team does not widen the result', async () => {
      const railways = await roles.salesTeam('railways');
      const defence  = await roles.salesTeam('defence');
      await leadFor(railways.execA.id, 'Railways deal');
      await leadFor(defence.execA.id, 'Defence deal');

      const res = await request(app)
        .get(`/api/leads?owner=${defence.execA.id}`)
        .set('Authorization', `Bearer ${railways.manager.token}`);

      const names = res.body.data.map((l) => l.name);
      expect(names).not.toContain('Defence deal');
    });

    it('a ?owner= inside the team narrows to that person', async () => {
      const { manager, execA, execB } = await roles.salesTeam();
      await leadFor(execA.id, 'Exec A deal');
      await leadFor(execB.id, 'Exec B deal');

      const res = await request(app)
        .get(`/api/leads?owner=${execB.id}`)
        .set('Authorization', `Bearer ${manager.token}`);

      expect(res.body.data.map((l) => l.name)).toEqual(['Exec B deal']);
    });

    it('the Director sees every team', async () => {
      const director = await roles.asDirector();
      const railways = await roles.salesTeam('railways');
      const defence  = await roles.salesTeam('defence');
      await leadFor(railways.execA.id, 'Railways deal');
      await leadFor(defence.execA.id, 'Defence deal');

      const res = await request(app).get('/api/leads')
        .set('Authorization', `Bearer ${director.token}`);

      const names = res.body.data.map((l) => l.name);
      expect(names).toEqual(expect.arrayContaining(['Railways deal', 'Defence deal']));
    });
  });

  describe('through HTTP — KPIs', () => {
    it('scopes pipeline value to the caller\'s team', async () => {
      const railways = await roles.salesTeam('railways');
      const defence  = await roles.salesTeam('defence');

      await Lead.create({ name: 'R', phone: '9100000001', source: 'referral',
        stage: 'engagement', owner: railways.execA.id, value: 1000 });
      await Lead.create({ name: 'D', phone: '9100000002', source: 'referral',
        stage: 'engagement', owner: defence.execA.id, value: 9000 });

      const res = await request(app).get('/api/kpis/sales')
        .set('Authorization', `Bearer ${railways.manager.token}`);

      const pipelineValue = res.body.data.metrics.find((m) => m.key === 'pipeline_value');
      /* 1000, not 10000: v2 answered the company total to every holder of kpi.read. */
      expect(pipelineValue.actual).toBe(1000);
    });
  });
});
