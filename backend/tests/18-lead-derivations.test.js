'use strict';
/**
 * Lead derivations — B1a/B1b.
 *
 * The dictionary's enforcement model is that a blank mandatory field never
 * blocks a save (capture at an expo must stay fast) — it flags the record and
 * blocks the next STAGE instead. These hooks are what produce the flag.
 *
 * ── Why every derivation lives in pre('validate') ────────────────────────
 * `Lead.insertMany()` runs validate middleware but NOT save middleware, and
 * bulk CSV import and bulk card scan both use it. With the derivations split
 * across the two hooks, bulk-imported leads were created with
 * needsReview:false and never surfaced in the review queue — the population
 * most likely to need reviewing was the one population that silently skipped
 * it. The `insertMany` cases below are the regression for that.
 */
const Lead     = require('../src/models/Lead');
const pipeline = require('../src/config/pipeline');
const { connect, disconnect, clearCollections } = require('./helpers/db');

const base = (over = {}) => ({
  name: 'Rajesh Kumar', phone: '9876543210', source: 'inbound_enquiry', ...over,
});

beforeAll(connect);
afterAll(disconnect);
beforeEach(clearCollections);

describe('zone is derived from state (C-8, A17)', () => {
  it.each([
    ['Maharashtra', 'west'], ['Tamil Nadu', 'south'],
    ['West Bengal', 'east'], ['Delhi', 'north'],
  ])('%s → %s', async (state, zone) => {
    const lead = await Lead.create(base({ state }));
    expect(lead.zone).toBe(zone);
  });

  it('leaves zone blank for an unrecognised state rather than guessing', async () => {
    const lead = await Lead.create(base({ state: 'Atlantis' }));
    expect(lead.zone).toBe('');
    expect(lead.reviewIssues).toContain('zone_underived');
  });

  it('does not overwrite a zone when state is absent', async () => {
    const lead = await Lead.create(base({ zone: 'south' }));
    expect(lead.zone).toBe('south');
  });
});

describe('opportunityName follows the dictionary format (C-9)', () => {
  it('composes [Company] — [Package] — [Mon YYYY]', async () => {
    const lead = await Lead.create(base({
      company: 'Sharma Industries',
      productPackage: 'SMART FACTORY',
      expectedCloseDate: new Date('2026-07-15T00:00:00Z'),
    }));
    expect(lead.opportunityName).toBe('Sharma Industries — SMART FACTORY — Jul 2026');
  });

  it('omits the package segment when there is none', async () => {
    const lead = await Lead.create(base({
      company: 'Sharma Industries', expectedCloseDate: new Date('2026-07-15T00:00:00Z'),
    }));
    expect(lead.opportunityName).toBe('Sharma Industries — Jul 2026');
  });

  it('never overwrites a name the user typed', async () => {
    const lead = await Lead.create(base({
      company: 'Sharma Industries', opportunityName: 'The Big One',
    }));
    expect(lead.opportunityName).toBe('The Big One');
  });

  it('stays blank without a company — there is nothing to compose from', async () => {
    const lead = await Lead.create(base());
    expect(lead.opportunityName).toBe('');
  });
});

describe('SPENCO is derived, never trusted from the client', () => {
  const scores = {
    size: 4, potential: 4, evidenceOfNeed: 4,
    needType: 4, competitionAwareness: 3, originOfNeed: 3,
  };

  it('computes total and qualified from the dimensions', async () => {
    const lead = await Lead.create(base({ spenco: { ...scores } }));
    expect(lead.spenco.total).toBe(22);
    expect(lead.spenco.qualified).toBe(true);
  });

  it('OVERWRITES a client-supplied qualified:true — otherwise the gate is bypassable', async () => {
    const lead = await Lead.create(base({
      spenco: { size: 0, potential: 0, evidenceOfNeed: 0, needType: 0, competitionAwareness: 0, originOfNeed: 0, qualified: true, total: 30 },
    }));
    expect(lead.spenco.total).toBe(0);
    expect(lead.spenco.qualified).toBe(false);
  });

  it('recomputes when the scores change', async () => {
    const lead = await Lead.create(base({ spenco: { ...scores } }));
    lead.spenco.size = 0;
    await lead.save();
    expect(lead.spenco.total).toBe(18);
    expect(lead.spenco.qualified).toBe(false); // size 0 fails the sub-gate
  });
});

describe('hygiene flags are computed on write', () => {
  it('flags a bare lead with the specific missing fields', async () => {
    const lead = await Lead.create(base());
    expect(lead.needsReview).toBe(true);
    expect(lead.reviewIssues).toEqual(expect.arrayContaining([
      'company_type_missing', 'designation_missing', 'next_action_missing',
    ]));
  });

  it('clears the flag once the record is complete', async () => {
    const soon = new Date(Date.now() + 5 * 86400000);
    const lead = await Lead.create(base({
      companyType: 'homeowner',          // non-B2B: email and industry not required
      jobTitle: 'Owner',
      company: 'Kumar Residence',
      state: 'Maharashtra',
      city: 'Pune',
      expectedCloseDate: soon,
      nextAction: 'Call to confirm site visit',
      nextFollowUpDate: soon,
    }));
    expect(lead.reviewIssues).toEqual([]);
    expect(lead.needsReview).toBe(false);
  });

  it('re-evaluates on update rather than going stale', async () => {
    const lead = await Lead.create(base());
    expect(lead.reviewIssues).toContain('company_type_missing');

    lead.companyType = 'msme_factory';
    await lead.save();
    expect(lead.reviewIssues).not.toContain('company_type_missing');
  });

  it('requires email and industry only for B2B (A6)', async () => {
    const b2b  = await Lead.create(base({ companyType: 'msme_factory' }));
    const home = await Lead.create(base({ phone: '9876500001', companyType: 'homeowner' }));

    expect(b2b.reviewIssues).toEqual(expect.arrayContaining(['email_missing', 'industry_segment_missing']));
    expect(home.reviewIssues).not.toContain('email_missing');
    expect(home.reviewIssues).not.toContain('industry_segment_missing');
  });
});

describe('insertMany gets the same derivations as save', () => {
  /* The regression: bulk CSV import and bulk card scan both use insertMany. */
  it('derives zone, opportunity name and hygiene for bulk-inserted leads', async () => {
    await Lead.insertMany([
      base({ company: 'Sharma Industries', state: 'Maharashtra', productPackage: 'SMART FACTORY' }),
      base({ phone: '9876500002', company: 'Iyer Textiles', state: 'Tamil Nadu' }),
    ]);

    const [a, b] = await Lead.find().sort({ company: 1 }).lean();

    expect(a.zone).toBe('south');           // Iyer Textiles, Tamil Nadu
    expect(b.zone).toBe('west');            // Sharma Industries, Maharashtra
    expect(b.opportunityName).toContain('Sharma Industries — SMART FACTORY');

    /* The bit that was silently false before. */
    expect(a.needsReview).toBe(true);
    expect(b.needsReview).toBe(true);
    expect(a.reviewIssues.length).toBeGreaterThan(0);
  });

  it('derives SPENCO on bulk insert too', async () => {
    await Lead.insertMany([base({
      spenco: { size: 5, potential: 5, evidenceOfNeed: 5, needType: 5, competitionAwareness: 5, originOfNeed: 5 },
    })]);
    const lead = await Lead.findOne().lean();
    expect(lead.spenco.total).toBe(30);
    expect(lead.spenco.qualified).toBe(true);
  });
});

describe('the legacy vocabulary is rejected, not silently upgraded (R-3)', () => {
  it.each(['new', 'contacted', 'interested', 'proposal', 'won', 'lost'])(
    'rejects legacy stage "%s"', async (stage) => {
      await expect(Lead.create(base({ stage }))).rejects.toThrow(/is not a valid enum value/);
    });

  it.each(['expo', 'direct', 'digital'])('rejects legacy source "%s"', async (source) => {
    await expect(Lead.create(base({ source }))).rejects.toThrow(/is not a valid enum value/);
  });

  it('rejects free-text lostReason now that it is an enum', async () => {
    await expect(Lead.create(base({ lostReason: 'Went with competitor' })))
      .rejects.toThrow(/is not a valid enum value/);
  });

  it('exposes no legacy mapping helper that could reintroduce silent upgrades', () => {
    expect(pipeline.LEGACY_STAGE_MAP).toBeUndefined();
    expect(pipeline.LEGACY_SOURCE_MAP).toBeUndefined();
  });

  it('defaults a new lead to the first stage of the framework pipeline', async () => {
    const lead = await Lead.create(base());
    expect(lead.stage).toBe('suspect');
    expect(pipeline.SALES_STAGES[0].key).toBe('suspect');
  });
});
