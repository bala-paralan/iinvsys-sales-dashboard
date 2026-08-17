'use strict';
/**
 * Configurable pipeline rules — R-2 — and the first coverage of `pipeline.js`
 * itself, which had none.
 *
 * Every test passes `rules` explicitly or restores the defaults in afterEach.
 * `setActiveRules` is process-global by design, and the one thing this suite
 * must not do is leave a threshold behind for the next file to trip over.
 */
const pipeline = require('../src/config/pipeline');
const runtime  = require('../src/config/pipelineRuntime');

const {
  SALES_STAGES, DEFAULT_RULES, SPENCO_MAX_TOTAL,
  spencoTotal, spencoQualified, isIndustrial, isB2B, deriveZone,
  canAdvance, validateStageEntry, evaluateTest, hygieneIssues,
  resolveStages, serialize, pipelineVersion,
} = pipeline;

afterEach(() => runtime.resetRules());

/* A SPENCO score of exactly 22/30 — above the default 18, below a raised 24. */
const spenco22 = {
  size: 4, potential: 4, evidenceOfNeed: 4,
  needType: 4, competitionAwareness: 3, originOfNeed: 3,
};

describe('pipeline — SPENCO scoring (A18)', () => {
  it('totals the six dimensions', () => {
    expect(spencoTotal(spenco22)).toBe(22);
  });

  it('clamps a dimension above the per-dimension maximum', () => {
    expect(spencoTotal({ ...spenco22, size: 99 })).toBe(23); // 4 → 5, not 99
  });

  it('qualifies at the default threshold of 18', () => {
    expect(spencoQualified(spenco22, DEFAULT_RULES)).toBe(true);
  });

  it('fails the total gate when the threshold is raised above the score', () => {
    expect(spencoQualified(spenco22, { ...DEFAULT_RULES, spencoMinTotal: 24 })).toBe(false);
  });

  it('fails a sub-gate even when the total passes', () => {
    const lopsided = {
      size: 0, potential: 5, evidenceOfNeed: 5,
      needType: 5, competitionAwareness: 5, originOfNeed: 5,
    };
    expect(spencoTotal(lopsided)).toBe(25);
    expect(spencoQualified(lopsided, DEFAULT_RULES)).toBe(false); // size 0 < 2
  });

  it('returns false for a missing score rather than throwing', () => {
    expect(spencoQualified(null)).toBe(false);
    expect(spencoQualified(undefined)).toBe(false);
  });
});

describe('pipeline — company type rules (A4, A6)', () => {
  it.each(['msme_factory', 'large_factory', 'system_integrator', 'epc', 'government_psu'])(
    '%s is industrial by default', (companyType) => {
      expect(isIndustrial({ companyType }, DEFAULT_RULES)).toBe(true);
    });

  it.each(['homeowner', 'builder_developer', 'distributor', 'other'])(
    '%s is not industrial by default', (companyType) => {
      expect(isIndustrial({ companyType }, DEFAULT_RULES)).toBe(false);
    });

  it('follows an overridden industrial set', () => {
    const rules = { ...DEFAULT_RULES, amcRequiredCompanyTypes: ['distributor'] };
    expect(isIndustrial({ companyType: 'distributor' }, rules)).toBe(true);
    expect(isIndustrial({ companyType: 'large_factory' }, rules)).toBe(false);
  });

  it('treats only homeowner as non-B2B, and unknown as B2B (the stricter read)', () => {
    expect(isB2B({ companyType: 'homeowner' })).toBe(false);
    expect(isB2B({ companyType: 'msme_factory' })).toBe(true);
    expect(isB2B({})).toBe(true);
  });
});

describe('pipeline — zone derivation (A17)', () => {
  it.each([
    ['Maharashtra', 'west'], ['Tamil Nadu', 'south'],
    ['West Bengal', 'east'], ['Delhi', 'north'],
  ])('%s → %s', (state, zone) => {
    expect(deriveZone(state, DEFAULT_RULES)).toBe(zone);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(deriveZone('  tamil   nadu ', DEFAULT_RULES)).toBe('south');
  });

  it('returns empty for an unrecognised state rather than guessing', () => {
    expect(deriveZone('Atlantis', DEFAULT_RULES)).toBe('');
    expect(deriveZone('', DEFAULT_RULES)).toBe('');
    expect(deriveZone(null, DEFAULT_RULES)).toBe('');
  });

  it('follows an overridden table', () => {
    expect(deriveZone('madhya pradesh', { ...DEFAULT_RULES, stateToZone: { 'madhya pradesh': 'north' } }))
      .toBe('north');
  });
});

describe('pipeline — transition rules (03-stage-gates.md)', () => {
  const adv = (from, to) => canAdvance(SALES_STAGES, from, to);

  it('allows exactly one stage forward, gated', () => {
    expect(adv('suspect', 'prospect')).toMatchObject({ ok: true, direction: 'forward', gated: true });
  });

  it('rejects skipping a stage', () => {
    expect(adv('suspect', 'engagement')).toMatchObject({ ok: false, reason: 'STAGE_SKIP' });
  });

  it('allows moving backward, ungated', () => {
    expect(adv('negotiation', 'prospect')).toMatchObject({ ok: true, gated: false });
  });

  it('allows order_lost from any open stage', () => {
    for (const from of ['suspect', 'prospect', 'engagement', 'negotiation']) {
      expect(adv(from, 'order_lost')).toMatchObject({ ok: true, gated: true });
    }
  });

  it('allows reopening a lost deal into an open stage', () => {
    expect(adv('order_lost', 'prospect').ok).toBe(true);
  });

  it('refuses to reopen a lost deal straight into commercial_order', () => {
    expect(adv('order_lost', 'commercial_order')).toMatchObject({ ok: false, reason: 'STAGE_SKIP' });
  });

  it('refuses to move out of commercial_order in any direction', () => {
    for (const to of ['negotiation', 'order_lost', 'suspect']) {
      expect(adv('commercial_order', to)).toMatchObject({ ok: false, reason: 'TERMINAL_STAGE' });
    }
  });

  it('treats a same-stage move as an ungated no-op, so plain Save never gates', () => {
    expect(adv('engagement', 'engagement')).toMatchObject({ ok: true, direction: 'same', gated: false });
  });

  it('rejects an unknown target stage', () => {
    expect(adv('suspect', 'nonsense')).toMatchObject({ ok: false, reason: 'UNKNOWN_STAGE' });
  });
});

describe('pipeline — evaluateTest fails closed on an unknown test', () => {
  it('an unrecognised test never passes, so a typo in a stage table surfaces', () => {
    expect(evaluateTest({ x: 'anything' }, { field: 'x', test: 'noSuchTest' })).toBe(false);
  });
});

describe('pipeline — the → commercial_order gate', () => {
  const base = {
    stage: 'negotiation',
    attachments: [{ docType: 'po' }],
    poNumber: 'PO-1',
    value: 100000,
    subscriptionOffered: 'yes',
    expectedCloseDate: new Date(),
  };
  const missingFields = (doc) =>
    validateStageEntry(doc, SALES_STAGES, 'commercial_order', new Date(), DEFAULT_RULES)
      .missing.map((m) => m.field);

  it('passes for a non-industrial company with no AMC answer', () => {
    const res = validateStageEntry(
      { ...base, companyType: 'homeowner' }, SALES_STAGES, 'commercial_order', new Date(), DEFAULT_RULES);
    expect(res.ok).toBe(true);
  });

  it('requires an AMC answer for an industrial company (A4)', () => {
    expect(missingFields({ ...base, companyType: 'large_factory' })).toContain('amcOffered');
  });

  it('accepts already_on_amc for an industrial company', () => {
    expect(missingFields({ ...base, companyType: 'large_factory', amcOffered: 'already_on_amc' }))
      .not.toContain('amcOffered');
  });

  it('requires the PO document — the framework document gate', () => {
    expect(missingFields({ ...base, companyType: 'homeowner', attachments: [] })).toContain('attachments');
  });

  it('reports every missing field at once, not just the first', () => {
    const missing = missingFields({ stage: 'negotiation', companyType: 'large_factory' });
    expect(missing).toEqual(expect.arrayContaining(
      ['attachments', 'poNumber', 'value', 'subscriptionOffered', 'amcOffered', 'expectedCloseDate']));
  });
});

describe('pipeline — the → prospect gate treats B2B conditionally (A6)', () => {
  const base = {
    jobTitle: 'Plant Operations Manager', company: 'Sharma Industries',
    city: 'Pune', state: 'Maharashtra', nextAction: 'Call MD',
    nextFollowUpDate: new Date(Date.now() + 86400000),
  };
  const missing = (doc) =>
    validateStageEntry(doc, SALES_STAGES, 'prospect', new Date(), DEFAULT_RULES)
      .missing.map((m) => m.field);

  it('requires email and industry for a B2B contact', () => {
    expect(missing({ ...base, companyType: 'msme_factory' }))
      .toEqual(expect.arrayContaining(['industrySegment', 'email']));
  });

  it('waives both for a homeowner', () => {
    const res = validateStageEntry(
      { ...base, companyType: 'homeowner' }, SALES_STAGES, 'prospect', new Date(), DEFAULT_RULES);
    expect(res.ok).toBe(true);
  });
});

describe('R-2 — resolveStages relocates the Competitor gate (A2)', () => {
  const fieldsAt = (stages, key) =>
    stages.find((s) => s.key === key).entryRequires.map((r) => r.field);

  it('defaults to Engagement', () => {
    const resolved = resolveStages(SALES_STAGES, DEFAULT_RULES);
    expect(fieldsAt(resolved, 'engagement')).toContain('competitor');
    expect(fieldsAt(resolved, 'prospect')).not.toContain('competitor');
  });

  it('moves both competitor rows to the configured stage', () => {
    const resolved = resolveStages(SALES_STAGES, { ...DEFAULT_RULES, competitorRequiredFromStage: 'negotiation' });
    expect(fieldsAt(resolved, 'negotiation')).toEqual(expect.arrayContaining(['competitor', 'competitorOther']));
    expect(fieldsAt(resolved, 'engagement')).not.toContain('competitor');
  });

  it('never mutates the module-level table', () => {
    resolveStages(SALES_STAGES, { ...DEFAULT_RULES, competitorRequiredFromStage: 'prospect' });
    expect(fieldsAt(SALES_STAGES, 'engagement')).toContain('competitor');
    expect(fieldsAt(SALES_STAGES, 'prospect')).not.toContain('competitor');
  });

  it('throws on a stage that does not exist, rather than dropping the rule', () => {
    expect(() => resolveStages(SALES_STAGES, { ...DEFAULT_RULES, competitorRequiredFromStage: 'qualified' }))
      .toThrow(/not a sales stage/);
  });

  it('the gate actually enforces at the relocated stage', () => {
    const rules = { ...DEFAULT_RULES, competitorRequiredFromStage: 'prospect' };
    const doc = {
      jobTitle: 'X', company: 'Y', companyType: 'homeowner', city: 'Pune', state: 'Maharashtra',
      nextAction: 'call', nextFollowUpDate: new Date(Date.now() + 86400000),
    };
    expect(validateStageEntry(doc, SALES_STAGES, 'prospect', new Date(), rules)
      .missing.map((m) => m.field)).toContain('competitor');
  });
});

describe('R-2 — the SPENCO gate message reflects the active threshold', () => {
  it('quotes the default', () => {
    const msg = resolveStages(SALES_STAGES, DEFAULT_RULES)
      .find((s) => s.key === 'engagement').entryRequires
      .find((r) => r.field === 'spenco.qualified').message;
    expect(msg).toContain(`18/${SPENCO_MAX_TOTAL}`);
  });

  it('quotes an override, so the UI never shows a stale number', () => {
    const msg = resolveStages(SALES_STAGES, { ...DEFAULT_RULES, spencoMinTotal: 24 })
      .find((s) => s.key === 'engagement').entryRequires
      .find((r) => r.field === 'spenco.qualified').message;
    expect(msg).toContain(`24/${SPENCO_MAX_TOTAL}`);
    expect(msg).not.toContain(`18/${SPENCO_MAX_TOTAL}`);
  });
});

describe('R-2 — setActiveRules', () => {
  it('installs overrides and leaves untouched keys at their defaults', () => {
    const rules = pipeline.setActiveRules({ spencoMinTotal: 25 });
    expect(rules.spencoMinTotal).toBe(25);
    expect(rules.probabilityOverrideMaxPoints).toBe(DEFAULT_RULES.probabilityOverrideMaxPoints);
  });

  it('is picked up by functions called without an explicit rules argument', () => {
    expect(spencoQualified(spenco22)).toBe(true);
    pipeline.setActiveRules({ spencoMinTotal: 24 });
    expect(spencoQualified(spenco22)).toBe(false);
  });

  it('rejects an unknown rule key instead of silently ignoring it', () => {
    expect(() => pipeline.setActiveRules({ spencoMinTotl: 24 })).toThrow(/Unknown pipeline rule key/);
  });

  it('returns a frozen object', () => {
    const rules = pipeline.setActiveRules({});
    expect(Object.isFrozen(rules)).toBe(true);
  });

  it('resetRules restores every default', () => {
    pipeline.setActiveRules({ spencoMinTotal: 30, competitorRequiredFromStage: 'suspect' });
    expect(runtime.resetRules()).toEqual(DEFAULT_RULES);
  });
});

describe('R-2 — the version hash invalidates client caches', () => {
  it('changes when a rule changes', () => {
    expect(pipelineVersion(DEFAULT_RULES))
      .not.toBe(pipelineVersion({ ...DEFAULT_RULES, spencoMinTotal: 24 }));
  });

  it('is stable for the same rules', () => {
    expect(pipelineVersion(DEFAULT_RULES)).toBe(pipelineVersion({ ...DEFAULT_RULES }));
  });

  it('serialize() reports the version and thresholds of the ACTIVE rules', () => {
    pipeline.setActiveRules({ spencoMinTotal: 24 });
    const payload = serialize();
    expect(payload.spenco.minTotal).toBe(24);
    expect(payload.version).toBe(pipelineVersion(pipeline.getActiveRules()));
  });
});

describe('R-2 — resolveOverrides validates stored Settings', () => {
  const ok = (key, value) => runtime.resolveOverrides([{ key, value }]);

  it('coerces and accepts a valid threshold', () => {
    expect(ok('pipeline.spenco.minTotal', 24).overrides).toEqual({ spencoMinTotal: 24 });
  });

  it('rejects a threshold above the achievable maximum', () => {
    const { overrides, errors } = ok('pipeline.spenco.minTotal', 99);
    expect(overrides).toEqual({});
    expect(errors[0]).toMatchObject({ key: 'pipeline.spenco.minTotal' });
  });

  it('rejects an unknown SPENCO dimension', () => {
    expect(ok('pipeline.spenco.subGates', { charisma: 3 }).errors).toHaveLength(1);
  });

  it('rejects an unknown company type in the AMC set', () => {
    expect(ok('pipeline.amcRequiredCompanyTypes', ['spaceship_factory']).errors).toHaveLength(1);
  });

  it('rejects a competitor stage that is not an open sales stage', () => {
    expect(ok('pipeline.competitorRequiredFromStage', 'commercial_order').errors).toHaveLength(1);
    expect(ok('pipeline.competitorRequiredFromStage', 'negotiation').errors).toHaveLength(0);
  });

  it('rejects an unknown zone in the state table', () => {
    expect(ok('pipeline.stateToZone', { goa: 'central' }).errors).toHaveLength(1);
  });

  it('parses a JSON string value, which is how Mixed settings often arrive', () => {
    expect(ok('pipeline.amcRequiredCompanyTypes', '["epc"]').overrides)
      .toEqual({ amcRequiredCompanyTypes: ['epc'] });
  });

  it('coerces the delay-clock boolean (A12)', () => {
    expect(ok('pipeline.delayClockResetsOnRevision', 'true').overrides)
      .toEqual({ delayClockResetsOnRevision: true });
  });

  it('ignores Settings that are not pipeline rules', () => {
    expect(runtime.resolveOverrides([{ key: 'smtp.host', value: 'x' }]))
      .toEqual({ overrides: {}, errors: [] });
  });

  it('keeps the valid rows when one row is invalid', () => {
    const { overrides, errors } = runtime.resolveOverrides([
      { key: 'pipeline.spenco.minTotal', value: 24 },
      { key: 'pipeline.competitorRequiredFromStage', value: 'nope' },
    ]);
    expect(overrides).toEqual({ spencoMinTotal: 24 });
    expect(errors).toHaveLength(1);
  });
});

describe('R-2 — every seeded Setting is a key the resolver understands', () => {
  it('seedDefinitions and SPEC agree', () => {
    expect(runtime.seedDefinitions().map((d) => d.key).sort())
      .toEqual([...runtime.RULE_SETTING_KEYS].sort());
  });

  it('each seeded default round-trips through the resolver without error', () => {
    const { errors } = runtime.resolveOverrides(runtime.seedDefinitions());
    expect(errors).toEqual([]);
  });

  it('the round-tripped defaults equal DEFAULT_RULES', () => {
    const { overrides } = runtime.resolveOverrides(runtime.seedDefinitions());
    for (const [rule, value] of Object.entries(overrides)) {
      expect(value).toEqual(DEFAULT_RULES[rule]);
    }
  });
});

describe('pipeline — hygieneIssues respects configured thresholds', () => {
  const codes = (lead, rules) => hygieneIssues(lead, new Date(), rules).map((i) => i.code);

  it('flags a follow-up beyond the horizon with no reason', () => {
    const lead = {
      stage: 'suspect', companyType: 'homeowner', state: 'Maharashtra', zone: 'west',
      jobTitle: 'X', expectedCloseDate: new Date(Date.now() + 30 * 86400000),
      nextAction: 'call', nextFollowUpDate: new Date(Date.now() + 20 * 86400000),
    };
    expect(codes(lead, DEFAULT_RULES)).toContain('followup_far_unexplained');
    expect(codes(lead, { ...DEFAULT_RULES, followUpMaxDaysAhead: 30 }))
      .not.toContain('followup_far_unexplained');
  });

  it('does not flag hygiene on a terminal stage', () => {
    expect(codes({ stage: 'commercial_order', companyType: 'homeowner', jobTitle: 'X', state: 'Goa', zone: 'west' }, DEFAULT_RULES))
      .not.toContain('followup_missing');
  });
});
