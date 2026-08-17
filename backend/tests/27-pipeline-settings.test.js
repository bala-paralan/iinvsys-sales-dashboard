'use strict';
/**
 * The R-2 rule editor's write path.
 *
 * R-2 made ten blocking assumptions runtime-configurable, but the ONLY way to
 * change them was the generic `PUT /api/settings`, which validated nothing and
 * re-installed nothing. Two consequences, both defended here:
 *
 *   · a nonsense value was accepted silently, and the STRICT loader then
 *     refused to boot in production — days later, with the cause invisible
 *   · a valid change sat in the database until the next restart while the UI
 *     reported it saved and the gates kept using the old value
 */
const request = require('supertest');
const app = require('../src/app');
const Lead = require('../src/models/Lead');
const Setting = require('../src/models/Setting');
const AuditLog = require('../src/models/AuditLog');
const pipeline = require('../src/config/pipeline');
const runtime = require('../src/config/pipelineRuntime');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');

let adminToken, managerToken, agentToken;

const get = (path, token) =>
  request(app).get(`/api/settings${path}`).set('Authorization', `Bearer ${token}`);
const put = (path, body, token) =>
  request(app).put(`/api/settings${path}`).set('Authorization', `Bearer ${token}`).send(body);

beforeAll(connect);
afterAll(async () => { await clearCollections(); await disconnect(); });

beforeEach(async () => {
  await clearCollections();
  pipeline.setActiveRules({});                 // back to compiled-in defaults
  await runtime.seedRuleSettings();
  adminToken = tok(await insertUser({ role: 'superadmin', name: 'Root' }));
  managerToken = tok(await insertUser({ role: 'manager', name: 'Sneha' }));
  agentToken = tok(await insertUser({ role: 'agent', name: 'Rahul' }));
});

afterEach(() => { pipeline.setActiveRules({}); });

/* ══════════════════════════════════════════════════════════════════════════ */

describe('GET /api/settings/pipeline', () => {
  it('returns every configurable rule with its value, default and spec', async () => {
    const res = await get('/pipeline', managerToken);
    expect(res.status).toBe(200);

    const keys = res.body.data.rules.map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(runtime.RULE_SETTING_KEYS));
    expect(keys).toHaveLength(runtime.RULE_SETTING_KEYS.length);

    const spenco = res.body.data.rules.find((r) => r.key === 'pipeline.spenco.minTotal');
    expect(spenco).toMatchObject({
      rule: 'spencoMinTotal',
      value: pipeline.DEFAULT_RULES.spencoMinTotal,
      default: pipeline.DEFAULT_RULES.spencoMinTotal,
      overridden: false,
    });
    /* The label and description come from the backend spec, so the editor can
       render an unfamiliar rule without knowing it by name. */
    expect(spenco.label).toBeTruthy();
    expect(spenco.description).toMatch(/A18/);
  });

  it('is not readable below manager, and not writable below superadmin', async () => {
    expect((await get('/pipeline', agentToken)).status).toBe(403);
    expect((await put('/pipeline', { updates: { 'pipeline.spenco.minTotal': 20 } }, managerToken)).status)
      .toBe(403);
  });

  it('does not collide with GET /api/settings/:key', async () => {
    /* `/settings/pipeline` must not resolve to getSetting('pipeline'). */
    const res = await get('/pipeline', adminToken);
    expect(res.body.data.rules).toBeDefined();
  });
});

describe('PUT /api/settings/pipeline', () => {
  it('applies a change immediately — no restart', async () => {
    const before = pipeline.getActiveRules().spencoMinTotal;
    const res = await put('/pipeline', { updates: { 'pipeline.spenco.minTotal': 24 } }, adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data.changed).toEqual(['pipeline.spenco.minTotal']);
    /* The live rule object, not just the stored document. Without the
       re-install this assertion still saw the old value. */
    expect(pipeline.getActiveRules().spencoMinTotal).toBe(24);
    expect(pipeline.getActiveRules().spencoMinTotal).not.toBe(before);
  });

  it('changes the version hash, so cached gate checklists are dropped', async () => {
    const before = pipeline.pipelineVersion();
    const res = await put('/pipeline', { updates: { 'pipeline.spenco.minTotal': 24 } }, adminToken);
    expect(res.body.data.version).not.toBe(before);
    expect(res.body.data.version).toBe(pipeline.pipelineVersion());
  });

  it('actually moves the gate a lead has to clear', async () => {
    /* The end-to-end property: this setting is not a display value, it decides
       whether a real deal advances. Total 18 — exactly the default floor. */
    const spenco = { size: 3, potential: 3, evidenceOfNeed: 3, needType: 3, competitionAwareness: 3, originOfNeed: 3 };
    const mk = () => Lead.create({
      name: 'Threshold', phone: `98765${Math.floor(10000 + Math.random() * 89999)}`,
      source: 'exhibition_event', stage: 'prospect', company: 'Sharma Industries',
      state: 'Maharashtra', value: 250000, competitor: 'none_known',
      productPackage: 'SMART FACTORY', jobTitle: 'Head', companyType: 'homeowner',
      city: 'Pune', nextAction: 'Call', nextFollowUpDate: new Date(Date.now() + 7 * 86400000),
      expectedCloseDate: new Date(Date.now() + 30 * 86400000), spenco,
    });

    const before = await mk();
    expect(before.spenco.qualified).toBe(true);          // 18 >= 18

    await put('/pipeline', { updates: { 'pipeline.spenco.minTotal': 24 } }, adminToken);

    const after = await mk();
    expect(after.spenco.qualified).toBe(false);          // 18 < 24
    const res = await request(app).post(`/api/leads/${after._id}/advance`)
      .set('Authorization', `Bearer ${adminToken}`).send({ toStage: 'engagement' });
    expect(res.status).toBe(422);
    expect(res.body.missing.map((m) => m.field)).toContain('spenco.qualified');
  });

  it('rejects a value the strict loader would refuse to boot on', async () => {
    const res = await put('/pipeline', { updates: { 'pipeline.spenco.minTotal': 'eighteen' } }, adminToken);
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body.errors)).toMatch(/integer/);

    /* Nothing persisted, nothing installed — the failure is now at the moment
       of the edit rather than at the next production boot. */
    const doc = await Setting.findOne({ key: 'pipeline.spenco.minTotal' }).lean();
    expect(doc.value).toBe(pipeline.DEFAULT_RULES.spencoMinTotal);
    expect(pipeline.getActiveRules().spencoMinTotal).toBe(pipeline.DEFAULT_RULES.spencoMinTotal);
  });

  it('writes nothing when ANY key in the batch is invalid', async () => {
    const res = await put('/pipeline', {
      updates: {
        'pipeline.spenco.minTotal': 22,                       // fine
        'pipeline.competitorRequiredFromStage': 'atlantis',   // not a stage
      },
    }, adminToken);

    expect(res.status).toBe(422);
    /* A half-applied rule set is a pipeline nobody configured. */
    expect(pipeline.getActiveRules().spencoMinTotal).toBe(pipeline.DEFAULT_RULES.spencoMinTotal);
    const doc = await Setting.findOne({ key: 'pipeline.spenco.minTotal' }).lean();
    expect(doc.value).toBe(pipeline.DEFAULT_RULES.spencoMinTotal);
  });

  it('rejects an unknown rule key rather than storing a setting nothing reads', async () => {
    const res = await put('/pipeline', { updates: { 'pipeline.notARule': 1 } }, adminToken);
    expect(res.status).toBe(422);
    expect(await Setting.findOne({ key: 'pipeline.notARule' }).lean()).toBeNull();
  });

  it('validates a structured rule, not just scalars', async () => {
    const bad = await put('/pipeline', {
      updates: { 'pipeline.spenco.subGates': { notADimension: 2 } },
    }, adminToken);
    expect(bad.status).toBe(422);

    const good = await put('/pipeline', {
      updates: { 'pipeline.spenco.subGates': { evidenceOfNeed: 4 } },
    }, adminToken);
    expect(good.status).toBe(200);
    expect(pipeline.getActiveRules().spencoSubGates).toEqual({ evidenceOfNeed: 4 });
  });

  it('audits every change with its previous value', async () => {
    await put('/pipeline', { updates: { 'pipeline.inactivityAlertDays': 45 } }, adminToken);

    const entry = await AuditLog.findOne({ action: 'settings.rule_change' }).lean();
    expect(entry).not.toBeNull();
    expect(entry.meta).toMatchObject({
      key: 'pipeline.inactivityAlertDays',
      value: 45,
      previous: pipeline.DEFAULT_RULES.inactivityAlertDays,
    });
    /* Who changed a gate threshold is exactly the question an audit log is
       opened to answer. */
    expect(entry.actor.name).toBe('Root');
  });

  it('marks a changed rule as overridden on the way back out', async () => {
    await put('/pipeline', { updates: { 'pipeline.inactivityAlertDays': 45 } }, adminToken);
    const res = await get('/pipeline', adminToken);
    const row = res.body.data.rules.find((r) => r.key === 'pipeline.inactivityAlertDays');
    expect(row).toMatchObject({ value: 45, default: pipeline.DEFAULT_RULES.inactivityAlertDays, overridden: true });
  });

  it('requires an updates object', async () => {
    expect((await put('/pipeline', {}, adminToken)).status).toBe(422);
    expect((await put('/pipeline', { updates: {} }, adminToken)).status).toBe(422);
  });
});

describe('PUT /api/settings (generic)', () => {
  it('refuses pipeline rules and says where they belong', async () => {
    /* The generic endpoint has no validation at all. Letting a rule through it
       is how an unbootable value reached the database. */
    const res = await put('', { updates: { 'pipeline.spenco.minTotal': 'nonsense' } }, adminToken);
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/settings\/pipeline/);

    const doc = await Setting.findOne({ key: 'pipeline.spenco.minTotal' }).lean();
    expect(doc.value).toBe(pipeline.DEFAULT_RULES.spencoMinTotal);
  });

  it('still handles ordinary settings', async () => {
    const res = await put('', { updates: { 'company.name': 'IINVSYS Pvt Ltd' } }, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.map['company.name']).toBe('IINVSYS Pvt Ltd');
  });
});
