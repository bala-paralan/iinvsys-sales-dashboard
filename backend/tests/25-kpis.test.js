'use strict';
/**
 * B4 — the 21 KPIs of docs/requirements/05-kpi-definitions.md.
 *
 * Every rate is checked against a HAND-COMPUTED fixture, because the failure
 * mode of a KPI is not a crash — it is a plausible wrong number that nobody
 * questions. A test that asserts `actual > 0` would pass on a KPI that divides
 * by the wrong denominator, and that is precisely the bug worth catching.
 *
 * The other properties defended here:
 *   · a zero denominator reports `null`, never `0` or `NaN`
 *   · windows are half-open and in Asia/Kolkata, so a delivery at 02:00 IST on
 *     1 August is an AUGUST delivery even though it is 31 July in UTC
 *   · targets come from pipeline.KPI_TARGETS and are never restated
 *   · kpi.read gates the endpoints
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const Lead = require('../src/models/Lead');
const WorkOrder = require('../src/models/WorkOrder');
const InstallationJob = require('../src/models/InstallationJob');
const kpis = require('../src/services/kpiService');
const pipeline = require('../src/config/pipeline');
const bd = require('../src/utils/businessDays');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');

let managerToken, techToken, referrerToken, agentToken;

/* A fixed window well clear of "now", so nothing created by a test's own
   timestamps drifts into it. July 2026, in IST. */
const JULY = { from: new Date('2026-06-30T18:30:00.000Z'), to: new Date('2026-07-31T18:30:00.000Z'), label: '2026-07-01..2026-07-31' };
const inJuly = (day, hour = 12) =>
  new Date(Date.UTC(2026, 6, day, hour - 5, hour >= 6 ? 30 : 0)); // rough IST noon

let phoneSeq = 60000;
const phone = () => `98765${phoneSeq++}`;

/* WorkOrder.lead is required and uniquely indexed — every fixture gets its own
   synthetic upstream id. The KPIs never read through it except for the
   installation lead time, which the installation fixtures wire up properly. */
const makeWorkOrder = (attrs) => WorkOrder.create({
  lead: new mongoose.Types.ObjectId(), ...attrs,
});

/** A lead with a hand-written stageHistory — the KPIs read only this. */
async function leadWithHistory(entries, extra = {}) {
  const lead = await Lead.create({
    name: 'Fixture', phone: phone(), source: 'exhibition_event',
    company: 'Fixture Co', state: 'Maharashtra', ...extra,
  });
  /* The model seeds a creation entry; the fixture replaces it wholesale so the
     history under test is exactly what the test wrote.
     `from` is chained from the previous entry unless stated, so the FIRST entry
     is a creation (from: null) and the rest are transitions — which is what
     separates a lead that converted from one that was imported mid-funnel. */
  lead.stageHistory = entries.map((e, i) => ({
    from: e.from ?? (i === 0 ? null : entries[i - 1].to),
    to: e.to, at: e.at, direction: 'forward',
  }));
  await lead.save();
  return lead;
}

beforeAll(connect);
/* Leave the database as we found it — the next suite may not clear first. */
afterAll(async () => { await clearCollections(); await disconnect(); });
beforeEach(async () => {
  await clearCollections();
  managerToken = tok(await insertUser({ role: 'manager', name: 'Sneha' }));
  techToken = tok(await insertUser({ role: 'technician', name: 'Tara' }));
  referrerToken = tok(await insertUser({ role: 'referrer', name: 'Ravi' }));
  agentToken = tok(await insertUser({ role: 'agent', name: 'Anil' }));
});

/* ══════════════════════════════════════════════════════════════════════════
   Windows
   ══════════════════════════════════════════════════════════════════════════ */

describe('reporting windows', () => {
  it('defaults to the last complete calendar month, in IST', () => {
    const w = kpis.resolveWindow({}, new Date('2026-08-14T09:00:00Z'));
    expect(w.label).toBe('2026-07-01..2026-07-31');
    /* IST midnight on 1 July = 18:30 UTC on 30 June. A UTC-bounded window
       would start 5.5 hours late and drop that evening's activity. */
    expect(w.from.toISOString()).toBe('2026-06-30T18:30:00.000Z');
    expect(w.to.toISOString()).toBe('2026-07-31T18:30:00.000Z');
  });

  it('period=current_month gives month-to-date', () => {
    const w = kpis.resolveWindow({ period: 'current_month' }, new Date('2026-08-14T09:00:00Z'));
    expect(w.label).toBe('2026-08-01..2026-08-31');
  });

  it('rolls the year over at January', () => {
    const w = kpis.resolveWindow({}, new Date('2026-01-09T09:00:00Z'));
    expect(w.label).toBe('2025-12-01..2025-12-31');
  });

  it('treats an explicit `to` as INCLUSIVE of that day', () => {
    const w = kpis.resolveWindow({ from: '2026-07-01', to: '2026-07-31' });
    /* The exclusive bound is IST midnight on 1 August — anything else silently
       drops everything that happened on the 31st. */
    expect(w.to.toISOString()).toBe('2026-07-31T18:30:00.000Z');
    expect(w.label).toBe('2026-07-01..2026-07-31');
  });

  it('rejects a reversed or malformed range', () => {
    expect(() => kpis.resolveWindow({ from: '2026-07-31', to: '2026-07-01' })).toThrow(RangeError);
    expect(() => kpis.resolveWindow({ from: 'last tuesday' })).toThrow(RangeError);
    expect(() => kpis.resolveWindow({ period: 'fortnight' })).toThrow(RangeError);
  });

  it('monthWindow is half-open, so the last day is included', () => {
    const w = bd.monthWindow(new Date('2026-08-14T09:00:00Z'), 1);
    const lastMoment = new Date('2026-07-31T18:29:59.000Z'); // 23:59:59 IST on the 31st
    expect(lastMoment >= w.from && lastMoment < w.to).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Status banding
   ══════════════════════════════════════════════════════════════════════════ */

describe('status banding', () => {
  const minDef = { target: 40, direction: 'min' };
  const maxDef = { target: 48, direction: 'max' };

  it('bands a "higher is better" KPI', () => {
    expect(kpis.statusOf(41, minDef)).toBe('ok');
    expect(kpis.statusOf(40, minDef)).toBe('ok');
    expect(kpis.statusOf(37, minDef)).toBe('warn');   // within 10%
    expect(kpis.statusOf(35, minDef)).toBe('breach');
  });

  it('bands a "lower is better" KPI', () => {
    expect(kpis.statusOf(40, maxDef)).toBe('ok');
    expect(kpis.statusOf(52, maxDef)).toBe('warn');   // within 10% over
    expect(kpis.statusOf(60, maxDef)).toBe('breach');
  });

  it('is null — not ok — when there is no target or no data', () => {
    expect(kpis.statusOf(120, { target: null, direction: 'min' })).toBeNull();
    expect(kpis.statusOf(null, minDef)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Process 1 — Sales
   ══════════════════════════════════════════════════════════════════════════ */

describe('Sales KPIs', () => {
  const by = (metrics, key) => metrics.find((m) => m.key === key);

  it('computes conversion rates against hand-counted fixtures', async () => {
    /* 4 entered suspect, 2 of them reached prospect  → 50%
       3 entered engagement, 2 reached negotiation    → 66.7%
       2 entered negotiation, 1 was won               → 50%                  */
    await leadWithHistory([{ to: 'suspect', at: inJuly(2) }]);
    await leadWithHistory([{ to: 'suspect', at: inJuly(3) }]);
    await leadWithHistory([
      { to: 'suspect', at: inJuly(4) }, { to: 'prospect', at: inJuly(5) },
      { to: 'engagement', at: inJuly(6) },
    ]);
    await leadWithHistory([
      { to: 'suspect', at: inJuly(7) }, { to: 'prospect', at: inJuly(8) },
      { to: 'engagement', at: inJuly(9) }, { to: 'negotiation', at: inJuly(10) },
    ]);
    await leadWithHistory([
      { to: 'engagement', at: inJuly(11) }, { to: 'negotiation', at: inJuly(12) },
      { to: 'commercial_order', at: inJuly(13) },
    ]);

    const m = await kpis.salesKpis(JULY);

    expect(by(m, 'suspect_to_prospect')).toMatchObject({ numerator: 2, denominator: 4, actual: 50 });
    expect(by(m, 'prospect_to_proposal')).toMatchObject({ numerator: 2, denominator: 3, actual: 66.7 });
    expect(by(m, 'win_rate')).toMatchObject({ numerator: 1, denominator: 2, actual: 50 });
  });

  it('counts a lead once even when it re-enters a stage', async () => {
    /* Pushed back to prospect and advanced again: two entries into
       engagement, but ONE lead converting. Counting entries would put the
       rate above 100% and make the dashboard nonsense. */
    await leadWithHistory([
      { to: 'suspect', at: inJuly(2) }, { to: 'prospect', at: inJuly(3) },
      { to: 'engagement', at: inJuly(4) }, { to: 'prospect', at: inJuly(5) },
      { to: 'engagement', at: inJuly(6) },
    ]);
    const m = await kpis.salesKpis(JULY);
    expect(by(m, 'suspect_to_prospect')).toMatchObject({ numerator: 1, denominator: 1, actual: 100 });
  });

  it('never exceeds 100% when leads are created mid-funnel', async () => {
    /* Bulk import, an expo backlog, a rep entering a deal already in flight:
       these leads have an entry into Prospect but never entered Suspect. On
       live seeded data, counting their creation entry in the numerator
       reported Suspect-to-Prospect at 140%. */
    await leadWithHistory([{ to: 'suspect', at: inJuly(2) }, { to: 'prospect', at: inJuly(3), from: 'suspect' }]);
    await leadWithHistory([{ to: 'prospect', at: inJuly(4) }]);          // created AT prospect
    await leadWithHistory([{ to: 'prospect', at: inJuly(5) }]);          // created AT prospect

    const m = await kpis.salesKpis(JULY);
    /* One real conversion out of one real suspect. The two mid-funnel leads
       sit out the conversion they were never part of. */
    expect(by(m, 'suspect_to_prospect')).toMatchObject({ numerator: 1, denominator: 1, actual: 100 });
  });

  it('counts a mid-funnel lead in a DENOMINATOR it genuinely belongs to', async () => {
    /* Created at Negotiation and won: it never converted INTO negotiation, so
       it is absent from the prospect_to_proposal numerator — but it really did
       reach Negotiation, so win_rate must still hold it to account. */
    await leadWithHistory([
      { to: 'negotiation', at: inJuly(4) },
      { to: 'commercial_order', at: inJuly(9), from: 'negotiation' },
    ]);
    await leadWithHistory([{ to: 'negotiation', at: inJuly(5) }]);

    const m = await kpis.salesKpis(JULY);
    expect(by(m, 'prospect_to_proposal')).toMatchObject({ numerator: 0, denominator: 0 });
    expect(by(m, 'win_rate')).toMatchObject({ numerator: 1, denominator: 2, actual: 50 });
  });

  it('excludes transitions outside the window', async () => {
    await leadWithHistory([{ to: 'suspect', at: new Date('2026-06-15T06:00:00Z') }]);
    await leadWithHistory([{ to: 'suspect', at: new Date('2026-08-15T06:00:00Z') }]);
    const m = await kpis.salesKpis(JULY);
    expect(by(m, 'suspect_to_prospect').denominator).toBe(0);
  });

  it('reports null — not zero — when nothing entered the stage', async () => {
    const m = await kpis.salesKpis(JULY);
    const k = by(m, 'suspect_to_prospect');
    expect(k.actual).toBeNull();
    expect(k.status).toBeNull();
    expect(k.denominator).toBe(0);
  });

  it('measures sales cycle from creation to the win, for deals won in the window', async () => {
    const lead = await leadWithHistory([
      { to: 'negotiation', at: inJuly(15) },
      { to: 'commercial_order', at: inJuly(21) },
    ]);
    /* A lead IMPORTED as already-won has no cycle to measure — its zero-day
       "cycle" would drag the mean toward zero. */
    await leadWithHistory([{ to: 'commercial_order', at: inJuly(22) }]);
    /* Raw driver: Mongoose's timestamps plugin owns createdAt on a model
       write, so a model-level $set is not a reliable way to age a fixture. */
    await Lead.collection.updateOne({ _id: lead._id }, { $set: { createdAt: inJuly(1) } });

    const m = await kpis.salesKpis(JULY);
    const cycle = by(m, 'sales_cycle_days');
    expect(cycle.actual).toBe(20);
    expect(cycle.denominator).toBe(1);
    /* No target in the source document — so no invented pass. */
    expect(cycle.target).toBeNull();
    expect(cycle.status).toBeNull();
  });

  it('reports pipeline value as a snapshot of open deals, weighted by probability', async () => {
    await Lead.create({ name: 'A', phone: phone(), source: 'inbound_enquiry', stage: 'prospect', value: 100000, probability: 25 });
    await Lead.create({ name: 'B', phone: phone(), source: 'inbound_enquiry', stage: 'negotiation', value: 200000, probability: 75 });
    /* Won and lost are terminal — neither is still "in the pipeline". */
    await Lead.create({ name: 'C', phone: phone(), source: 'inbound_enquiry', stage: 'commercial_order', value: 900000, probability: 100 });

    const m = await kpis.salesKpis(JULY);
    expect(by(m, 'pipeline_value').actual).toBe(300000);
    expect(by(m, 'weighted_pipeline').actual).toBe(175000); // 25k + 150k
  });

  it('computes PO accuracy from Work Order revisions', async () => {
    await makeWorkOrder({ woNumber: 'WO-1', customerSnapshot: { name: 'X' }, createdAt: inJuly(5), revisionCount: 0 });
    await makeWorkOrder({ woNumber: 'WO-2', customerSnapshot: { name: 'Y' }, createdAt: inJuly(6), revisionCount: 2 });
    await makeWorkOrder({ woNumber: 'WO-3', customerSnapshot: { name: 'Z' }, createdAt: inJuly(7), revisionCount: 0 });

    const m = await kpis.salesKpis(JULY);
    expect(by(m, 'po_accuracy')).toMatchObject({ numerator: 2, denominator: 3, actual: 66.7, status: 'breach' });
  });

  it('takes every label and target from pipeline.KPI_TARGETS', async () => {
    const m = await kpis.salesKpis(JULY);
    for (const metric of m) {
      const def = pipeline.KPI_TARGETS.sales[metric.key];
      expect(def).toBeDefined();
      expect(metric.label).toBe(def.label);
      expect(metric.target).toBe(def.target);
      expect(metric.unit).toBe(def.unit);
    }
    expect(m).toHaveLength(7);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Process 2 — Delivery
   ══════════════════════════════════════════════════════════════════════════ */

describe('Delivery KPIs', () => {
  const by = (metrics, key) => metrics.find((m) => m.key === key);

  const wo = (n, attrs) => makeWorkOrder({
    woNumber: `WO-D${n}`, customerSnapshot: { name: `Cust ${n}` }, ...attrs,
  });

  const DA = [
    { docType: 'delivery_acknowledgement', filename: 'da.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: 'k1' },
    { docType: 'da_photo', filename: 'p.png', mimeType: 'image/png', sizeBytes: 10, storageKey: 'k2' },
  ];

  it('measures on-time delivery against the ORIGINAL committed date', async () => {
    /* The whole point of originalCommittedDate being write-once: measuring
       against the current date would make every revised delivery on time. */
    await wo(1, { deliveredAt: inJuly(10), originalCommittedDate: inJuly(12), currentCommittedDate: inJuly(12) });
    await wo(2, { deliveredAt: inJuly(20), originalCommittedDate: inJuly(15), currentCommittedDate: inJuly(25) });

    const m = await kpis.deliveryKpis(JULY);
    expect(by(m, 'on_time_delivery')).toMatchObject({ numerator: 1, denominator: 2, actual: 50 });
  });

  it('excludes never-promised deliveries from the on-time denominator', async () => {
    await wo(3, { deliveredAt: inJuly(10), originalCommittedDate: inJuly(12) });
    await wo(4, { deliveredAt: inJuly(11), originalCommittedDate: null });

    const m = await kpis.deliveryKpis(JULY);
    /* A delivery with no committed date was never late — it was never
       promised. It still counts for accuracy and DA completion. */
    expect(by(m, 'on_time_delivery')).toMatchObject({ numerator: 1, denominator: 1 });
    expect(by(m, 'delivery_accuracy').denominator).toBe(2);
  });

  it('measures date notification in BUSINESS days from acceptance', async () => {
    /* Accepted Friday 3 July, committed Monday 6 July = 1 business day. On a
       calendar-day clock this is 3 days and reports as a breach. */
    await wo(5, { acceptedAt: new Date('2026-07-03T06:00:00Z'), committedDateSetAt: new Date('2026-07-06T06:00:00Z') });
    await wo(6, { acceptedAt: inJuly(8), committedDateSetAt: inJuly(14) });

    const m = await kpis.deliveryKpis(JULY);
    expect(by(m, 'date_notification_rate')).toMatchObject({ numerator: 1, denominator: 2, actual: 50 });
  });

  it('counts delay EVENTS, not work orders', async () => {
    /* One work order delayed three times with one late notice is 2/3
       compliant. Counting work orders would report it as a single failure. */
    await wo(7, {
      deliveredAt: inJuly(28), originalCommittedDate: inJuly(20),
      delayEvents: [
        { reasonCode: 'supplier_delay', previousDate: inJuly(20), revisedDate: inJuly(24), noticeHours: 96, at: inJuly(16) },
        { reasonCode: 'logistics_delay', previousDate: inJuly(24), revisedDate: inJuly(26), noticeHours: 50, at: inJuly(22) },
        { reasonCode: 'logistics_delay', previousDate: inJuly(26), revisedDate: inJuly(28), noticeHours: 12, at: inJuly(25) },
      ],
    });

    const m = await kpis.deliveryKpis(JULY);
    expect(by(m, 'delay_notice_compliance')).toMatchObject({ numerator: 2, denominator: 3, actual: 66.7 });
  });

  it('reads the delay threshold from the pipeline, not a literal', async () => {
    await wo(8, {
      deliveredAt: inJuly(28),
      delayEvents: [{
        reasonCode: 'supplier_delay', previousDate: inJuly(20), revisedDate: inJuly(24),
        noticeHours: pipeline.DELAY_NOTICE_MIN_HOURS, at: inJuly(16),
      }],
    });
    const m = await kpis.deliveryKpis(JULY);
    /* Exactly at the threshold is compliant — ">= 48 hours' notice". */
    expect(by(m, 'delay_notice_compliance').actual).toBe(100);
  });

  it('computes accuracy, DA completion and damage rate over deliveries', async () => {
    await wo(9, { deliveredAt: inJuly(10), attachments: DA, deliveryAccuracy: { itemsDelivered: 3, discrepancies: [] } });
    await wo(10, { deliveredAt: inJuly(11), attachments: DA, deliveryAccuracy: { itemsDelivered: 3, discrepancies: ['1 unit short'] }, damageReported: true });
    await wo(11, { deliveredAt: inJuly(12), attachments: [DA[0]], deliveryAccuracy: { itemsDelivered: 2, discrepancies: [] } });

    const m = await kpis.deliveryKpis(JULY);
    expect(by(m, 'delivery_accuracy')).toMatchObject({ numerator: 2, denominator: 3 });
    /* DA completion below 100% means the gate was bypassed at the database
       level — which is exactly what this fixture did, on purpose. */
    expect(by(m, 'da_completion')).toMatchObject({ numerator: 2, denominator: 3, status: 'breach' });
    expect(by(m, 'damage_rate')).toMatchObject({ numerator: 1, denominator: 3, actual: 33.3, status: 'breach' });
  });

  it('places an IST-evening delivery in the right month', async () => {
    /* 02:00 IST on 1 August is 20:30 UTC on 31 July. A UTC-bounded July
       window would count it as a July delivery. */
    await wo(12, { deliveredAt: new Date('2026-07-31T20:30:00Z'), originalCommittedDate: inJuly(30) });
    const july = await kpis.deliveryKpis(JULY);
    expect(by(july, 'delivery_accuracy').denominator).toBe(0);

    const august = kpis.resolveWindow({ from: '2026-08-01', to: '2026-08-31' });
    const aug = await kpis.deliveryKpis(august);
    expect(by(aug, 'delivery_accuracy').denominator).toBe(1);
  });

  it('returns all seven metrics with pipeline targets', async () => {
    const m = await kpis.deliveryKpis(JULY);
    expect(m).toHaveLength(7);
    for (const metric of m) {
      expect(metric.target).toBe(pipeline.KPI_TARGETS.delivery[metric.key].target);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Process 3 — Installation & Customer Service
   ══════════════════════════════════════════════════════════════════════════ */

describe('Installation KPIs', () => {
  const by = (metrics, key) => metrics.find((m) => m.key === key);
  let seq = 0;

  async function job(attrs = {}, woAttrs = {}) {
    seq += 1;
    const order = await makeWorkOrder({
      woNumber: `WO-I${seq}`, customerSnapshot: { name: `Cust ${seq}` }, ...woAttrs,
    });
    return InstallationJob.create({
      jobNumber: `IJ-2026-${String(100000 + seq)}`,
      workOrder: order._id,
      customerSnapshot: { name: `Cust ${seq}` },
      ...attrs,
    });
  }

  it('measures install lead time in BUSINESS days from the DA', async () => {
    /* Delivered Friday 3 July, completed Wednesday 8 July = 3 business days
       (Mon, Tue, Wed). On calendar days it is 5 and sits exactly on target,
       which is how a breach hides. */
    await job({ completedAt: new Date('2026-07-08T06:00:00Z') },
      { deliveredAt: new Date('2026-07-03T06:00:00Z') });

    const m = await kpis.installationKpis(JULY);
    expect(by(m, 'install_lead_time_days')).toMatchObject({ actual: 3, denominator: 1, status: 'ok' });
  });

  it('excludes jobs whose work order never recorded a delivery', async () => {
    await job({ completedAt: inJuly(10) }, { deliveredAt: null });
    const m = await kpis.installationKpis(JULY);
    /* Measuring from a null date would report a 20,000-day lead time. */
    expect(by(m, 'install_lead_time_days').actual).toBeNull();
    expect(by(m, 'first_time_right').denominator).toBe(1);
  });

  it('computes first-time-right over jobs completed in the window', async () => {
    await job({ completedAt: inJuly(10), firstTimeRight: true });
    await job({ completedAt: inJuly(11), firstTimeRight: true });
    await job({ completedAt: inJuly(12), firstTimeRight: false });

    const m = await kpis.installationKpis(JULY);
    expect(by(m, 'first_time_right')).toMatchObject({ numerator: 2, denominator: 3, actual: 66.7, status: 'breach' });
  });

  it('requires a clean pass — no retests — for commissioning pass rate', async () => {
    await job({ commissioning: { passed: true, retestCount: 0, customerCountersignedAt: inJuly(10) } });
    await job({ commissioning: { passed: true, retestCount: 1, customerCountersignedAt: inJuly(11) } });

    const m = await kpis.installationKpis(JULY);
    /* Passing on the second attempt is a pass, but not a FIRST-time pass —
       counting it would make the metric indistinguishable from "eventually
       worked", which is every job. */
    expect(by(m, 'commissioning_pass')).toMatchObject({ numerator: 1, denominator: 2 });
  });

  it('computes handover certificate rate over handovers in the window', async () => {
    await job({
      handover: { handedOverAt: inJuly(10) },
      attachments: [{ docType: 'handover_certificate', filename: 'h.pdf', mimeType: 'application/pdf', sizeBytes: 9, storageKey: 'k' }],
    });
    await job({ handover: { handedOverAt: inJuly(11) }, attachments: [] });

    const m = await kpis.installationKpis(JULY);
    expect(by(m, 'handover_cert_rate')).toMatchObject({ numerator: 1, denominator: 2, status: 'breach' });
  });

  it('averages issue resolution across issues, not jobs', async () => {
    await job({
      postSupport: {
        issues: [
          { description: 'a', reportedAt: inJuly(10), resolvedAt: new Date(inJuly(10).getTime() + 24 * 3600000) },
          { description: 'b', reportedAt: inJuly(11), resolvedAt: new Date(inJuly(11).getTime() + 72 * 3600000) },
          { description: 'c', reportedAt: inJuly(12), resolvedAt: null },
        ],
      },
    });

    const m = await kpis.installationKpis(JULY);
    /* (24 + 72) / 2 = 48. The unresolved issue has no duration yet and must
       not be counted as zero. */
    expect(by(m, 'issue_resolution_hours')).toMatchObject({ actual: 48, denominator: 2, status: 'ok' });
  });

  it('averages CSAT over feedback received in the window', async () => {
    await job({ feedback: { receivedAt: inJuly(10), csat: 5 } });
    await job({ feedback: { receivedAt: inJuly(11), csat: 4 } });
    await job({ feedback: { receivedAt: inJuly(12), csat: 2 } });

    const m = await kpis.installationKpis(JULY);
    const csat = by(m, 'csat');
    expect(csat.actual).toBe(3.67);           // score unit keeps 2dp
    expect(csat.denominator).toBe(3);
    expect(csat.target).toBe(pipeline.KPI_TARGETS.installation.csat.target);
    /* 3.67 against a target of 4.0 is inside the 10% warn band, not a breach. */
    expect(csat.status).toBe('warn');
  });

  it('bands a clearly-missed CSAT as a breach', async () => {
    await job({ feedback: { receivedAt: inJuly(10), csat: 2 } });
    await job({ feedback: { receivedAt: inJuly(11), csat: 3 } });
    const m = await kpis.installationKpis(JULY);
    expect(by(m, 'csat')).toMatchObject({ actual: 2.5, status: 'breach' });
  });

  it('measures feedback collection as TIMELY return, not eventual return (A15)', async () => {
    const d = inJuly(1);
    await job({ feedback: { dispatchedAt: d, receivedAt: new Date(d.getTime() + 10 * 86400000) } });
    await job({ feedback: { dispatchedAt: d, receivedAt: new Date(d.getTime() + 45 * 86400000) } });
    await job({ feedback: { dispatchedAt: d, receivedAt: null } });

    const m = await kpis.installationKpis(JULY);
    /* Eventual collection is 100% by construction — the closure gate makes it
       so — which is why the target can only be about promptness. */
    expect(by(m, 'feedback_collection')).toMatchObject({ numerator: 1, denominator: 3, actual: 33.3 });
  });

  it('returns all seven metrics with pipeline targets', async () => {
    const m = await kpis.installationKpis(JULY);
    expect(m).toHaveLength(7);
    for (const metric of m) {
      expect(metric.target).toBe(pipeline.KPI_TARGETS.installation[metric.key].target);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Hygiene counters
   ══════════════════════════════════════════════════════════════════════════ */

describe('sales hygiene counters', () => {
  it('counts the five manager-dashboard queues', async () => {
    const old = new Date(Date.now() - (pipeline.INACTIVITY_ALERT_DAYS + 5) * 86400000);
    await Lead.create({ name: 'Stale', phone: phone(), source: 'inbound_enquiry', stage: 'prospect', lastContact: old });
    await Lead.create({
      name: 'Expired', phone: phone(), source: 'inbound_enquiry', stage: 'engagement',
      lastContact: new Date(), expectedCloseDate: new Date(Date.now() - 86400000),
    });

    const c = await kpis.salesHygieneCounters();
    expect(c.leads_inactive_30d).toBe(1);
    expect(c.leads_close_date_expired).toBe(1);
    expect(c.leads_missing_followup).toBe(2);   // neither has a next follow-up
    expect(typeof c.leads_needing_review).toBe('number');
    expect(typeof c.leads_stage_age_exceeded).toBe('number');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Routes and authorisation
   ══════════════════════════════════════════════════════════════════════════ */

describe('GET /api/kpis', () => {
  const get = (path, token) =>
    request(app).get(`/api/kpis${path}`).set('Authorization', `Bearer ${token}`);

  it('serves each process with its window echoed back', async () => {
    for (const p of ['sales', 'delivery', 'installation']) {
      const res = await get(`/${p}?from=2026-07-01&to=2026-07-31`, managerToken);
      expect(res.status).toBe(200);
      expect(res.body.data.process).toBe(p);
      expect(res.body.data.window.label).toBe('2026-07-01..2026-07-31');
      expect(res.body.data.metrics).toHaveLength(7);
      expect(res.body.data.metrics.every((m) => m.window === '2026-07-01..2026-07-31')).toBe(true);
    }
  });

  it('attaches the hygiene counters to the sales dashboard only', async () => {
    const sales = await get('/sales', managerToken);
    expect(sales.body.data.counters).toHaveProperty('leads_needing_review');
    const delivery = await get('/delivery', managerToken);
    expect(delivery.body.data.counters).toBeUndefined();
  });

  it('serves all 21 KPIs from /summary with a health roll-up', async () => {
    const res = await get('/summary?from=2026-07-01&to=2026-07-31', managerToken);
    expect(res.status).toBe(200);
    const { sales, delivery, installation, health } = res.body.data;
    expect(sales.length + delivery.length + installation.length).toBe(21);
    /* On an empty database nothing can pass or fail — every metric is
       unmeasured, and reporting 21 green would be a lie. */
    expect(health.unmeasured).toBe(21);
    expect(health.ok).toBe(0);
    expect(health.breach).toBe(0);
  });

  it('answers 400 — not 500 — on a malformed window', async () => {
    const res = await get('/sales?from=yesterday', managerToken);
    expect(res.status).toBe(400);
  });

  it('requires kpi.read', async () => {
    expect((await get('/sales', managerToken)).status).toBe(200);
    expect((await get('/sales', agentToken)).status).toBe(200);
    /* A technician and a referrer have no dashboard — doc 04 grants neither
       kpi.read, and neither should see company-wide conversion rates. */
    expect((await get('/sales', techToken)).status).toBe(403);
    expect((await get('/summary', referrerToken)).status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    expect((await request(app).get('/api/kpis/sales')).status).toBe(401);
  });
});
