'use strict';
const Setting  = require('../src/models/Setting');
const pipeline = require('../src/config/pipeline');
const runtime  = require('../src/config/pipelineRuntime');
const { connect, disconnect, clearCollections } = require('./helpers/db');

beforeAll(connect);
afterAll(disconnect);
beforeEach(async () => { await clearCollections(); runtime.resetRules(); });

it('seeds every rule, and re-seeding never clobbers an operator value', async () => {
  const seeded = await runtime.seedRuleSettings();
  expect(seeded.sort()).toEqual([...runtime.RULE_SETTING_KEYS].sort());

  await Setting.updateOne({ key: 'pipeline.spenco.minTotal' }, { value: 24 });
  expect(await runtime.seedRuleSettings()).toEqual([]);
  expect((await Setting.findOne({ key: 'pipeline.spenco.minTotal' })).value).toBe(24);
});

it('loadRules installs the stored override', async () => {
  await runtime.seedRuleSettings();
  await Setting.updateOne({ key: 'pipeline.spenco.minTotal' }, { value: 24 });
  await Setting.updateOne({ key: 'pipeline.competitorRequiredFromStage' }, { value: 'prospect' });

  const { rules, errors, changed } = await runtime.loadRules();
  expect(errors).toEqual([]);
  expect(rules.spencoMinTotal).toBe(24);

  /* Only genuine departures from the default are reported, not all ten seeded rows. */
  expect(changed.sort()).toEqual(['competitorRequiredFromStage', 'spencoMinTotal']);

  const payload = pipeline.serialize();
  expect(payload.spenco.minTotal).toBe(24);
  expect(payload.sales.stages.find(s => s.key === 'prospect')
    .entryRequires.some(r => r.field === 'competitor')).toBe(true);
});

it('an invalid stored value throws in strict mode and is survivable otherwise', async () => {
  await runtime.seedRuleSettings();
  await Setting.updateOne({ key: 'pipeline.spenco.minTotal' }, { value: 999 });

  await expect(runtime.loadRules({ strict: true })).rejects.toThrow(/Invalid pipeline rule setting/);

  const { rules, errors } = await runtime.loadRules({ strict: false });
  expect(errors).toHaveLength(1);
  expect(rules.spencoMinTotal).toBe(pipeline.DEFAULT_RULES.spencoMinTotal);
});
