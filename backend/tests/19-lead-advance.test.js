'use strict';
/**
 * The stage transition contract — B1c.
 * docs/requirements/03-stage-gates.md
 *
 * The property this suite exists to defend is the all-or-nothing write:
 *
 *   "Nothing is persisted when a gate fails."
 *
 * That is what makes "fill in the three missing fields and advance" one
 * request instead of a half-applied write. If it ever regresses, a rep who
 * gets a 422 will have silently had some of their edits saved and some not,
 * and nobody will notice until the data is already wrong.
 */
const request  = require('supertest');
const app      = require('../src/app');
const Lead     = require('../src/models/Lead');
const Agent    = require('../src/models/Agent');
const AuditLog = require('../src/models/AuditLog');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');

let adminToken, managerToken, agentToken, agentProfile;

const soon = () => new Date(Date.now() + 14 * 86400000);

/** A lead that satisfies everything the → prospect gate asks for. */
const prospectReady = (over = {}) => ({
  name: 'Rajesh Kumar', phone: '9876543210', source: 'exhibition_event',
  jobTitle: 'Plant Operations Manager', company: 'Sharma Industries',
  companyType: 'homeowner',            // non-B2B: email/industry not required
  city: 'Pune', state: 'Maharashtra',
  nextAction: 'Send revised commercial proposal',
  nextFollowUpDate: soon(),
  ...over,
});

const mkLead = (over = {}) => Lead.create(prospectReady(over));

const advance = (id, body, token = adminToken) =>
  request(app).post(`/api/leads/${id}/advance`)
    .set('Authorization', `Bearer ${token}`).send(body);

beforeAll(connect);
afterAll(disconnect);
beforeEach(async () => {
  await clearCollections();
  adminToken   = tok(await insertUser({ role: 'superadmin', name: 'Root' }));
  managerToken = tok(await insertUser({ role: 'manager', name: 'Sneha' }));
  agentProfile = await Agent.create({
    name: 'Rahul', initials: 'RS', email: 'rahul@iinvsys.test',
    phone: '9876500000', territory: 'West',
  });
  agentToken = tok(await insertUser({ role: 'agent', name: 'Rahul', agentId: agentProfile._id }));
});

describe('the four movement rules', () => {
  it('advances exactly one stage forward when the gate passes', async () => {
    const lead = await mkLead();
    const res = await advance(lead._id, { toStage: 'prospect' });

    expect(res.status).toBe(200);
    expect(res.body.data.lead.stage).toBe('prospect');
    expect(res.body.data.transition).toMatchObject({ from: 'suspect', to: 'prospect', direction: 'forward' });
  });

  it('refuses to skip a stage', async () => {
    const lead = await mkLead();
    const res = await advance(lead._id, { toStage: 'engagement' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('STAGE_SKIP');
    expect((await Lead.findById(lead._id)).stage).toBe('suspect');
  });

  it('allows a backward move, ungated', async () => {
    const lead = await mkLead({ stage: 'negotiation' });
    const res = await advance(lead._id, { toStage: 'prospect', note: 'customer went quiet' });

    expect(res.status).toBe(200);
    expect(res.body.data.transition.direction).toBe('backward');
  });

  it('allows order_lost from any open stage', async () => {
    for (const stage of ['suspect', 'prospect', 'engagement', 'negotiation']) {
      const lead = await mkLead({ stage, phone: `98765${Math.floor(Math.random() * 90000)}` });
      const res = await advance(lead._id, {
        toStage: 'order_lost',
        patch: { lostReason: 'price_too_high', lostTo: 'competitor', lostToName: 'Siemens' },
      });
      expect(res.status).toBe(200);
    }
  });

  it('refuses to move out of commercial_order — a Work Order exists downstream', async () => {
    const lead = await mkLead({ stage: 'commercial_order' });
    const res = await advance(lead._id, { toStage: 'negotiation' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('TERMINAL_STAGE');
  });

  it('allows re-engaging a lost deal into an open stage', async () => {
    const lead = await mkLead({ stage: 'order_lost' });
    const res = await advance(lead._id, { toStage: 'prospect', note: 'budget freed up' });
    expect(res.status).toBe(200);
  });

  it('refuses to reopen a lost deal straight into commercial_order', async () => {
    const lead = await mkLead({ stage: 'order_lost' });
    const res = await advance(lead._id, { toStage: 'commercial_order' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('STAGE_SKIP');
  });
});

describe('the gate reports what is missing', () => {
  it('names every unmet requirement, not just the first', async () => {
    const bare = await Lead.create({ name: 'Bare', phone: '9876500001', source: 'cold_call' });
    const res = await advance(bare._id, { toStage: 'prospect' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('STAGE_GATE_FAILED');
    const fields = res.body.missing.map((m) => m.field);
    expect(fields).toEqual(expect.arrayContaining(
      ['jobTitle', 'company', 'companyType', 'city', 'state', 'nextAction', 'nextFollowUpDate']));
  });

  it('each missing entry carries the message the UI renders', async () => {
    const bare = await Lead.create({ name: 'Bare', phone: '9876500002', source: 'cold_call' });
    const res = await advance(bare._id, { toStage: 'prospect' });

    for (const m of res.body.missing) {
      expect(typeof m.field).toBe('string');
      expect(typeof m.message).toBe('string');
      expect(m.message.length).toBeGreaterThan(0);
    }
  });
});

describe('NOTHING is persisted when a gate fails', () => {
  it('discards the whole patch, not just the invalid part', async () => {
    const bare = await Lead.create({ name: 'Bare', phone: '9876500003', source: 'cold_call' });

    const res = await advance(bare._id, {
      toStage: 'prospect',
      /* company and city are valid and would have saved under a partial write;
         the rest of the gate is still unmet. */
      patch: { company: 'Sharma Industries', city: 'Pune', jobTitle: 'Plant Manager' },
    });
    expect(res.status).toBe(422);

    const after = await Lead.findById(bare._id).lean();
    expect(after.stage).toBe('suspect');
    expect(after.company).toBe('');   // ← the all-or-nothing property
    expect(after.city).toBe('');
    expect(after.jobTitle).toBe('');
    /* Only the opening "Lead created" entry — no TRANSITION was recorded.
       (Every lead now starts with one, so the Suspect-to-Prospect KPI has a
       denominator; see Lead.pre('validate').) */
    expect(after.stageHistory.filter((h) => h.from !== null)).toHaveLength(0);
    expect(after.stageHistory).toHaveLength(1);
  });

  it('a patch that COMPLETES the gate is saved with the transition', async () => {
    const bare = await Lead.create({ name: 'Bare', phone: '9876500004', source: 'cold_call' });

    const res = await advance(bare._id, {
      toStage: 'prospect',
      patch: {
        jobTitle: 'Plant Operations Manager', company: 'Sharma Industries',
        companyType: 'homeowner', city: 'Pune', state: 'Maharashtra',
        nextAction: 'Book a site visit', nextFollowUpDate: soon(),
      },
    });

    expect(res.status).toBe(200);
    const after = await Lead.findById(bare._id).lean();
    expect(after.stage).toBe('prospect');
    expect(after.company).toBe('Sharma Industries');
    expect(after.zone).toBe('west');   // the model hook still ran
  });
});

describe('the → commercial_order gate enforces the framework document rules', () => {
  const readyForOrder = (over = {}) => prospectReady({
    stage: 'negotiation',
    value: 250000,
    poNumber: 'PO-2026-114',
    subscriptionOffered: 'yes',
    expectedCloseDate: soon(),
    attachments: [{
      docType: 'po', filename: 'po.pdf', mimeType: 'application/pdf',
      sizeBytes: 1024, storageKey: 'abc123',
    }],
    ...over,
  });

  it('closes the deal when the PO and answers are present', async () => {
    const lead = await Lead.create(readyForOrder());
    const res = await advance(lead._id, { toStage: 'commercial_order' });
    expect(res.status).toBe(200);
  });

  it('refuses without the PO document', async () => {
    const lead = await Lead.create(readyForOrder({ attachments: [] }));
    const res = await advance(lead._id, { toStage: 'commercial_order' });
    expect(res.status).toBe(422);
    expect(res.body.missing.map((m) => m.field)).toContain('attachments');
  });

  it('requires an AMC answer for an industrial company type (A4)', async () => {
    const lead = await Lead.create(readyForOrder({ companyType: 'large_factory' }));
    const res = await advance(lead._id, { toStage: 'commercial_order' });
    expect(res.status).toBe(422);
    expect(res.body.missing.map((m) => m.field)).toContain('amcOffered');
  });

  it('waives the AMC answer for a non-industrial company type', async () => {
    const lead = await Lead.create(readyForOrder({ companyType: 'homeowner' }));
    const res = await advance(lead._id, { toStage: 'commercial_order' });
    expect(res.status).toBe(200);
  });
});

describe('SPENCO gates Prospect → Engagement (A18)', () => {
  const atProspect = (spenco) => prospectReady({
    stage: 'prospect', value: 250000, competitor: 'none_known',
    productPackage: 'SMART FACTORY', expectedCloseDate: soon(),
    spenco: { scoredAt: new Date(), ...spenco },
  });

  it('stamps scoredAt when a client scores the dimensions, so Engagement is reachable', async () => {
    /* The gate reads `spenco.scoredAt` and nothing used to write it — so no
       lead could pass Engagement through the API at all. Every test above
       hides that by hand-setting scoredAt in the fixture, which is exactly how
       a blocker stays invisible: the test encodes the workaround.
       This one scores SPENCO the way a client does — dimensions only. */
    const lead = await Lead.create(prospectReady({
      stage: 'prospect', value: 250000, competitor: 'none_known',
      productPackage: 'SMART FACTORY', expectedCloseDate: soon(), phone: '9876500055',
    }));
    expect(lead.spenco).toBeNull();   // no SPENCO at all yet

    const res = await advance(lead._id, {
      toStage: 'engagement',
      patch: { spenco: { size: 4, potential: 4, evidenceOfNeed: 4, needType: 4, competitionAwareness: 3, originOfNeed: 3 } },
    });

    expect(res.status).toBe(200);
    const after = await Lead.findById(lead._id).lean();
    expect(after.stage).toBe('engagement');
    expect(after.spenco.scoredAt).toBeInstanceOf(Date);
    expect(after.spenco.total).toBe(22);
    expect(after.spenco.qualified).toBe(true);
  });

  it('does not move scoredAt once it is set', async () => {
    const scoredAt = new Date('2026-07-01T06:00:00Z');
    const lead = await Lead.create(atProspect({
      size: 4, potential: 4, evidenceOfNeed: 4, needType: 4, competitionAwareness: 3, originOfNeed: 3,
    }));
    lead.spenco.scoredAt = scoredAt;
    await lead.save();

    /* Re-scoring records a changed assessment, not a new one — the stamp is
       when the deal was assessed, not when the row was last touched. */
    lead.spenco.potential = 5;
    await lead.save();
    expect((await Lead.findById(lead._id).lean()).spenco.scoredAt).toEqual(scoredAt);
  });

  it('refuses a score below the threshold', async () => {
    const lead = await Lead.create(atProspect({
      size: 1, potential: 1, evidenceOfNeed: 1, needType: 1, competitionAwareness: 1, originOfNeed: 1,
    }));
    const res = await advance(lead._id, { toStage: 'engagement' });
    expect(res.status).toBe(422);
    expect(res.body.missing.map((m) => m.field)).toContain('spenco.qualified');
  });

  it('passes a qualifying score', async () => {
    const lead = await Lead.create(atProspect({
      size: 4, potential: 4, evidenceOfNeed: 4, needType: 4, competitionAwareness: 3, originOfNeed: 3,
    }));
    const res = await advance(lead._id, { toStage: 'engagement' });
    expect(res.status).toBe(200);
  });

  it('cannot be bypassed by posting spenco.qualified directly in the patch', async () => {
    const lead = await Lead.create(atProspect({
      size: 0, potential: 0, evidenceOfNeed: 0, needType: 0, competitionAwareness: 0, originOfNeed: 0,
    }));
    const res = await advance(lead._id, {
      toStage: 'engagement',
      patch: { spenco: { scoredAt: new Date(), qualified: true, total: 30 } },
    });
    expect(res.status).toBe(422);
  });
});

describe('manager override', () => {
  const bare = () => Lead.create({ name: 'Bare', phone: '9876500005', source: 'cold_call' });

  it('a manager may force past a gate with a note', async () => {
    const lead = await bare();
    const res = await advance(lead._id, {
      toStage: 'prospect', force: true, gateOverrideNote: 'Customer signed offline at the expo',
    }, managerToken);

    expect(res.status).toBe(200);
    expect(res.body.data.transition.gateOverride).toBe(true);
    expect(res.body.data.transition.waived.length).toBeGreaterThan(0);
  });

  it('records exactly what was waived in stageHistory — never a silent override', async () => {
    const lead = await bare();
    await advance(lead._id, {
      toStage: 'prospect', force: true, gateOverrideNote: 'signed offline',
    }, managerToken);

    const after = await Lead.findById(lead._id).lean();
    const entry = after.stageHistory.at(-1);
    expect(entry.gateOverride).toBe(true);
    expect(entry.missingAtOverride).toEqual(expect.arrayContaining(['jobTitle.notEmpty', 'company.notEmpty']));
  });

  it('refuses a force with no explanation', async () => {
    const lead = await bare();
    const res = await advance(lead._id, { toStage: 'prospect', force: true }, managerToken);
    expect(res.status).toBe(400);
  });

  it('an AGENT cannot override — the permission is manager and above', async () => {
    const lead = await Lead.create({
      name: 'Bare', phone: '9876500006', source: 'cold_call', assignedAgent: agentProfile._id,
    });
    const res = await advance(lead._id, {
      toStage: 'prospect', force: true, gateOverrideNote: 'let me through',
    }, agentToken);

    expect(res.status).toBe(403);
    expect((await Lead.findById(lead._id)).stage).toBe('suspect');
  });
});

describe('stage history and audit', () => {
  it('appends an entry naming the actor and direction', async () => {
    const lead = await mkLead();
    await advance(lead._id, { toStage: 'prospect', note: 'discovery call done' });

    const after = await Lead.findById(lead._id).lean();
    /* [0] is the creation entry the model seeds; [1] is this transition. */
    expect(after.stageHistory).toHaveLength(2);
    expect(after.stageHistory[0]).toMatchObject({ from: null, to: 'suspect', note: 'Lead created' });
    expect(after.stageHistory[1]).toMatchObject({
      from: 'suspect', to: 'prospect', direction: 'forward',
      byName: 'Root', note: 'discovery call done', gateOverride: false,
    });
  });

  it('sets the stage default probability on arrival', async () => {
    const lead = await mkLead();
    await advance(lead._id, { toStage: 'prospect' });
    expect((await Lead.findById(lead._id)).probability).toBe(15);
  });

  it('writes an audit entry for the transition', async () => {
    const lead = await mkLead();
    await advance(lead._id, { toStage: 'prospect' });

    const e = await AuditLog.findOne({ action: 'stage.transition' }).lean();
    expect(e).not.toBeNull();
    expect(e.meta).toMatchObject({ from: 'suspect', to: 'prospect' });
  });

  it('writes a SEPARATE audit entry for an override', async () => {
    const lead = await Lead.create({ name: 'Bare', phone: '9876500007', source: 'cold_call' });
    await advance(lead._id, {
      toStage: 'prospect', force: true, gateOverrideNote: 'signed offline',
    }, managerToken);

    const e = await AuditLog.findOne({ action: 'stage.gate_override' }).lean();
    expect(e).not.toBeNull();
    expect(e.meta.missingAtOverride.length).toBeGreaterThan(0);
    expect(e.meta.note).toBe('signed offline');
  });
});

describe('GET /:id/gate — preflight', () => {
  it('reports which requirements are met and which are not', async () => {
    const lead = await Lead.create({
      name: 'Half', phone: '9876500008', source: 'cold_call',
      company: 'Sharma Industries', city: 'Pune',
    });

    const res = await request(app).get(`/api/leads/${lead._id}/gate?to=prospect`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(false);

    const byField = Object.fromEntries(res.body.data.requirements.map((r) => [r.field, r.met]));
    expect(byField.company).toBe(true);
    expect(byField.city).toBe(true);
    expect(byField.jobTitle).toBe(false);
  });

  it('defaults to the next stage forward', async () => {
    const lead = await mkLead();
    const res = await request(app).get(`/api/leads/${lead._id}/gate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.data.to).toBe('prospect');
    expect(res.body.data.ok).toBe(true);
  });

  it('changes nothing — it is a preview', async () => {
    const lead = await mkLead();
    await request(app).get(`/api/leads/${lead._id}/gate`).set('Authorization', `Bearer ${adminToken}`);
    expect((await Lead.findById(lead._id)).stage).toBe('suspect');
  });

  it('reports a closed stage rather than pretending there is a next one', async () => {
    const lead = await mkLead({ stage: 'commercial_order' });
    const res = await request(app).get(`/api/leads/${lead._id}/gate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.data.to).toBeNull();
  });
});

describe('GET /api/leads/hygiene — the manager worklist', () => {
  it('returns flagged leads with a breakdown by rule', async () => {
    await Lead.create({ name: 'Bare One', phone: '9876500009', source: 'cold_call' });
    await Lead.create({ name: 'Bare Two', phone: '9876500010', source: 'cold_call' });

    const res = await request(app).get('/api/leads/hygiene')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.leads.length).toBe(2);
    const codes = res.body.data.byCode.map((c) => c._id);
    expect(codes).toContain('company_type_missing');
  });

  it('excludes clean records', async () => {
    await mkLead({ companyType: 'homeowner', expectedCloseDate: soon() });
    const res = await request(app).get('/api/leads/hygiene')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.data.leads).toHaveLength(0);
  });

  it('filters to a single rule', async () => {
    await Lead.create({ name: 'Bare', phone: '9876500011', source: 'cold_call' });
    const res = await request(app).get('/api/leads/hygiene?code=designation_missing')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.data.leads).toHaveLength(1);
  });

  it('scopes an agent to their own book', async () => {
    await Lead.create({ name: 'Mine', phone: '9876500012', source: 'cold_call', assignedAgent: agentProfile._id });
    await Lead.create({ name: 'Someone else', phone: '9876500013', source: 'cold_call' });

    const res = await request(app).get('/api/leads/hygiene')
      .set('Authorization', `Bearer ${agentToken}`);
    expect(res.body.data.leads).toHaveLength(1);
    expect(res.body.data.leads[0].name).toBe('Mine');
  });
});

describe('access control', () => {
  it('an agent cannot advance a lead outside their book', async () => {
    const other = await Lead.create({ name: 'Not mine', phone: '9876500014', source: 'cold_call' });
    const res = await advance(other._id, { toStage: 'prospect' }, agentToken);
    expect(res.status).toBe(403);
  });

  it('requires the lead.advance permission', async () => {
    const warehouse = tok(await insertUser({ role: 'warehouse' }));
    const lead = await mkLead();
    const res = await advance(lead._id, { toStage: 'prospect' }, warehouse);
    expect(res.status).toBe(403);
  });

  it('rejects a request with no toStage', async () => {
    const lead = await mkLead();
    const res = await advance(lead._id, {});
    expect(res.status).toBe(400);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Server-owned fields, and the document upload that replaces forging them
   ══════════════════════════════════════════════════════════════════════════ */

describe('server-owned fields cannot be written by a client', () => {
  const put = (id, body, token = adminToken) =>
    request(app).put(`/api/leads/${id}`).set('Authorization', `Bearer ${token}`).send(body);

  it('refuses a forged attachment, which would defeat the PO gate outright', async () => {
    const lead = await mkLead({ stage: 'negotiation', poNumber: 'PO-9', value: 100000,
      subscriptionOffered: 'no', amcOffered: 'no' });

    /* Before attachments were stripped, this one call satisfied `hasDoc:po`
       and closed a deal with no purchase order anywhere in the system. */
    await put(lead._id, {
      attachments: [{ docType: 'po', filename: 'forged.pdf', mimeType: 'application/pdf',
        sizeBytes: 1, storageKey: 'nope' }],
    });

    const after = await Lead.findById(lead._id).lean();
    expect(after.attachments).toHaveLength(0);
  });

  it('refuses a forged stageHistory, which would inflate every conversion KPI', async () => {
    const lead = await mkLead();
    await put(lead._id, {
      stageHistory: [
        { from: 'suspect', to: 'prospect', at: new Date(), direction: 'forward' },
        { from: 'prospect', to: 'engagement', at: new Date(), direction: 'forward' },
      ],
    });

    const after = await Lead.findById(lead._id).lean();
    expect(after.stageHistory).toHaveLength(1);              // the creation entry only
    expect(after.stageHistory[0].note).toBe('Lead created');
  });

  it('ignores server-owned fields at creation too', async () => {
    const res = await request(app).post('/api/leads')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...prospectReady({ phone: '9876500077' }),
        needsReview: false, stageHistory: [{ from: null, to: 'negotiation', at: new Date() }] });

    expect(res.status).toBe(201);
    const after = await Lead.findById(res.body.data._id).lean();
    expect(after.stageHistory).toHaveLength(1);
    expect(after.stageHistory[0].to).toBe('suspect');
    expect(after.stageHistory[0].byName).toBe('Root');       // the actual creator
  });
});

describe('POST /api/leads/:id/upload — the PO gate becomes drivable (S-8)', () => {
  const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);

  const upload = (id, docType, token = adminToken) =>
    request(app).post(`/api/leads/${id}/upload`)
      .set('Authorization', `Bearer ${token}`)
      .field('docType', docType)
      .attach('file', PDF, 'po.pdf');

  it('attaches a real document and lets the lead reach Commercial Order', async () => {
    const lead = await mkLead({
      stage: 'negotiation', poNumber: 'PO-4417', value: 250000,
      subscriptionOffered: 'yes', amcOffered: 'no', expectedCloseDate: soon(),
    });

    /* Without a PO on file the gate refuses — this is the state the API could
       not previously escape, because nothing could put a document on a lead. */
    const blocked = await advance(lead._id, { toStage: 'commercial_order' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.missing.some((m) => /purchase order/i.test(m.message))).toBe(true);

    const up = await upload(lead._id, 'po');
    expect(up.status).toBe(201);
    expect(up.body.data.docType).toBe('po');

    const won = await advance(lead._id, { toStage: 'commercial_order' });
    expect(won.status).toBe(200);
  });

  it('rejects an unknown docType and a missing file', async () => {
    const lead = await mkLead();
    expect((await upload(lead._id, 'not_a_doc_type')).status).toBe(422);

    const noFile = await request(app).post(`/api/leads/${lead._id}/upload`)
      .set('Authorization', `Bearer ${adminToken}`).field('docType', 'po');
    expect(noFile.status).toBe(400);
  });

  it('scopes an agent to their own leads', async () => {
    const mine = await mkLead({ assignedAgent: agentProfile._id });
    const theirs = await mkLead({ phone: '9876500088' });

    expect((await upload(mine._id, 'quote', agentToken)).status).toBe(201);
    expect((await upload(theirs._id, 'quote', agentToken)).status).toBe(403);
  });
});
