'use strict';
/**
 * B4b — the monthly workbook.
 *
 * The property that matters most here is SCOPING. The previous export always
 * pulled every lead in the database, so an agent who could reach the report
 * mailed themselves the entire company pipeline. These tests open the produced
 * workbook and assert what is actually inside it, per role — an assertion on
 * the HTTP status would have passed against the old behaviour too.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const app = require('../src/app');
const Lead = require('../src/models/Lead');
const Agent = require('../src/models/Agent');
const WorkOrder = require('../src/models/WorkOrder');
const InstallationJob = require('../src/models/InstallationJob');
const { generateReportBuffer, scopeFor } = require('../src/utils/excelReport');
const pipeline = require('../src/config/pipeline');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');

let adminUser, managerUser, agentUser, agentProfile, otherAgent, techUser;
let adminToken, agentToken, techToken;

const inJuly = (d) => new Date(Date.UTC(2026, 6, d, 6, 30));
const WINDOW = { from: '2026-07-01', to: '2026-07-31' };

/** Load a produced workbook back out of its buffer. */
async function openWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

const sheetNames = (wb) => wb.worksheets.map((w) => w.name);

/** Every value in one column of a sheet, header row excluded. */
function column(ws, header) {
  const headers = ws.getRow(1).values;
  const idx = headers.indexOf(header);
  if (idx < 0) throw new Error(`No column "${header}" in ${ws.name}: ${headers.join(', ')}`);
  const out = [];
  ws.eachRow((row, n) => { if (n > 1) out.push(row.getCell(idx).value); });
  return out;
}

beforeAll(connect);
afterAll(async () => { await clearCollections(); await disconnect(); });

beforeEach(async () => {
  await clearCollections();

  agentProfile = await Agent.create({
    name: 'Rahul', initials: 'RS', email: 'rahul@iinvsys.test',
    phone: '9876500000', territory: 'West', target: 500000,
  });
  otherAgent = await Agent.create({
    name: 'Priya', initials: 'PK', email: 'priya@iinvsys.test',
    phone: '9876500001', territory: 'South', target: 400000,
  });

  const adminId = await insertUser({ role: 'superadmin', name: 'Root' });
  const managerId = await insertUser({ role: 'manager', name: 'Sneha' });
  const agentId = await insertUser({ role: 'agent', name: 'Rahul', agentId: agentProfile._id });
  const techId = await insertUser({ role: 'technician', name: 'Tara' });

  adminUser = { _id: adminId, role: 'superadmin' };
  managerUser = { _id: managerId, role: 'manager' };
  agentUser = { _id: agentId, role: 'agent', agentId: agentProfile._id };
  techUser = { _id: techId, role: 'technician' };

  adminToken = tok(adminId);
  agentToken = tok(agentId);
  techToken = tok(techId);

  await Lead.create({
    name: 'Mine', phone: '9811100001', source: 'exhibition_event', company: 'Sharma Industries',
    state: 'Maharashtra', stage: 'negotiation', value: 250000, assignedAgent: agentProfile._id,
  });
  await Lead.create({
    name: 'Theirs', phone: '9811100002', source: 'cold_call', company: 'Verma Foods',
    state: 'Karnataka', stage: 'commercial_order', value: 900000, assignedAgent: otherAgent._id,
  });

  const wo = await WorkOrder.create({
    woNumber: 'WO-2026-000001', lead: new mongoose.Types.ObjectId(),
    customerSnapshot: { name: 'Verma Foods', company: 'Verma Foods', zone: 'south' },
    acceptedAt: inJuly(2), originalCommittedDate: inJuly(10),
    currentCommittedDate: inJuly(14), deliveredAt: inJuly(14),
    delayEvents: [
      { reasonCode: 'supplier_delay', previousDate: inJuly(10), revisedDate: inJuly(14), noticeHours: 96, at: inJuly(5) },
      { reasonCode: 'supplier_delay', previousDate: inJuly(10), revisedDate: inJuly(14), noticeHours: 12, at: inJuly(9) },
      { reasonCode: 'logistics_delay', previousDate: inJuly(10), revisedDate: inJuly(12), noticeHours: 72, at: inJuly(6) },
    ],
  });

  await InstallationJob.create({
    jobNumber: 'IJ-2026-000001', workOrder: wo._id,
    customerSnapshot: { name: 'Verma Foods', company: 'Verma Foods' },
    technicianName: 'Tara', completedAt: inJuly(20), firstTimeRight: true,
    feedback: { dispatchedAt: inJuly(21), receivedAt: inJuly(24), csat: 2 },
    correctiveAction: { required: true, dueAt: inJuly(29), documentedAt: null },
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Scoping — the reason this file exists
   ══════════════════════════════════════════════════════════════════════════ */

describe('scoping', () => {
  it('gives a superadmin every sheet', async () => {
    const wb = await openWorkbook(await generateReportBuffer({ user: adminUser, query: WINDOW }));
    expect(sheetNames(wb)).toEqual([
      'KPI Summary', 'Sales Pipeline', 'Agent Performance',
      'Delivery', 'Delay Reason Codes', 'Installation & CS',
    ]);
  });

  it('gives an agent ONLY their own leads, and no delivery or installation', async () => {
    const wb = await openWorkbook(await generateReportBuffer({ user: agentUser, query: WINDOW }));

    /* An agent holds no workorder.read or install.read — those sheets are
       absent entirely rather than present and empty, which would still leak
       the shape of the operation. */
    expect(sheetNames(wb)).not.toContain('Delivery');
    expect(sheetNames(wb)).not.toContain('Installation & CS');

    const names = column(wb.getWorksheet('Sales Pipeline'), 'Contact');
    expect(names).toEqual(['Mine']);          // NOT 'Theirs'

    const agents = column(wb.getWorksheet('Agent Performance'), 'Agent');
    expect(agents).toEqual(['Rahul']);        // NOT Priya's numbers
  });

  it('refuses a role with nothing to export rather than writing an empty file', async () => {
    /* `readonly` holds no permissions at all. ExcelJS would happily produce a
       zero-sheet workbook that Excel then calls corrupt. */
    const readonlyUser = { _id: await insertUser({ role: 'readonly' }), role: 'readonly' };
    await expect(generateReportBuffer({ user: readonlyUser, query: WINDOW }))
      .rejects.toMatchObject({ code: 'EXPORT_EMPTY_SCOPE' });
  });

  it('gives a technician only their OWN jobs, and no KPI sheet', async () => {
    /* A technician holds install.read but not kpi.read. Without the technician
       filter this workbook held every job in the company, while
       GET /api/installations shows them only their own. */
    const wb = await openWorkbook(await generateReportBuffer({ user: techUser, query: WINDOW }));
    expect(sheetNames(wb)).toEqual(['Installation & CS']);
    const ws = wb.getWorksheet('Installation & CS');
    expect(ws.rowCount).toBe(1);              // header only — the job is unassigned
  });

  it('refuses to run with no user at all', async () => {
    await expect(generateReportBuffer({})).rejects.toThrow(/user is required/);
  });

  it('scopeFor states each role in one place', () => {
    expect(scopeFor(managerUser)).toMatchObject({ sales: true, delivery: true, installation: true });
    expect(scopeFor(agentUser)).toMatchObject({ sales: true, delivery: false, installation: false });
    expect(scopeFor(techUser)).toMatchObject({ sales: false, kpis: false, delivery: false, installation: true });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Contents
   ══════════════════════════════════════════════════════════════════════════ */

describe('workbook contents', () => {
  it('reports the same KPI numbers the API serves', async () => {
    const kpiService = require('../src/services/kpiService');
    const window = kpiService.resolveWindow(WINDOW);
    const fromApi = await kpiService.deliveryKpis(window);

    const wb = await openWorkbook(await generateReportBuffer({ user: adminUser, query: WINDOW }));
    const ws = wb.getWorksheet('KPI Summary');
    const labels = column(ws, 'KPI');
    const actuals = column(ws, 'Actual');

    /* One implementation of "on-time delivery", not two. */
    const onTime = fromApi.find((m) => m.key === 'on_time_delivery');
    expect(actuals[labels.indexOf(onTime.label)]).toBe(onTime.actual);
  });

  it('says "no data" rather than 0 for an unmeasured KPI', async () => {
    const wb = await openWorkbook(await generateReportBuffer({ user: adminUser, query: WINDOW }));
    const ws = wb.getWorksheet('KPI Summary');
    const actuals = column(ws, 'Actual');
    /* A blank or zero cell is a claim — "no on-time deliveries" rather than
       "no deliveries". At least one KPI has no data on this fixture. */
    expect(actuals).toContain('no data');
  });

  it('breaks delay reason codes down for the monthly review (D-10)', async () => {
    const wb = await openWorkbook(await generateReportBuffer({ user: adminUser, query: WINDOW }));
    const ws = wb.getWorksheet('Delay Reason Codes');

    const codes = column(ws, 'Reason Code');
    const counts = column(ws, 'Delays');
    const late = column(ws, 'Late Notices (<48h)');

    /* Sorted by frequency — the pattern a manager acts on. */
    expect(codes[0]).toBe('Supplier delay');
    expect(counts[0]).toBe(2);
    expect(late[0]).toBe(1);            // the 12-hour notice
    expect(codes[1]).toBe('Logistics delay');
  });

  it('marks an outstanding corrective action, distinct from "not required"', async () => {
    const wb = await openWorkbook(await generateReportBuffer({ user: adminUser, query: WINDOW }));
    const ws = wb.getWorksheet('Installation & CS');
    expect(column(ws, 'Corrective Action')).toEqual(['OUTSTANDING']);
    expect(column(ws, 'CSAT')).toEqual([2]);
  });

  it('leaves win rate blank for an agent with no leads, rather than 0%', async () => {
    await Lead.deleteMany({});
    const wb = await openWorkbook(await generateReportBuffer({ user: adminUser, query: WINDOW }));
    const ws = wb.getWorksheet('Agent Performance');
    /* A new joiner has not achieved a 0% win rate — they have not had the
       chance to win yet, and a 0 in this column reads as a performance figure. */
    expect(column(ws, 'Win Rate %')).toEqual(['—', '—']);
  });

  it('does not call a still-open work order late', async () => {
    await WorkOrder.updateOne({ woNumber: 'WO-2026-000001' }, { $set: { deliveredAt: null } });
    const wb = await openWorkbook(await generateReportBuffer({ user: adminUser, query: WINDOW }));
    expect(column(wb.getWorksheet('Delivery'), 'On Time')).toEqual(['—']);
  });

  it('uses pipeline labels, never raw enum keys', async () => {
    const wb = await openWorkbook(await generateReportBuffer({ user: adminUser, query: WINDOW }));
    const stages = column(wb.getWorksheet('Sales Pipeline'), 'Stage');
    expect(stages).toContain(pipeline.stageLabel(pipeline.SALES_STAGES, 'negotiation'));
    expect(stages).not.toContain('negotiation');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The download endpoint
   ══════════════════════════════════════════════════════════════════════════ */

describe('GET /api/reports/export.xlsx', () => {
  const get = (token, qs = '') =>
    request(app).get(`/api/reports/export.xlsx${qs}`).set('Authorization', `Bearer ${token}`);

  it('returns a real xlsx with the right headers', async () => {
    const res = await get(adminToken, '?from=2026-07-01&to=2026-07-31').responseType('blob');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="IINVSYS-report-\d{4}-\d{2}-\d{2}\.xlsx"/);

    const wb = await openWorkbook(res.body);
    expect(sheetNames(wb)).toContain('KPI Summary');
  });

  it('scopes the download to the caller', async () => {
    const res = await get(agentToken).responseType('blob');
    expect(res.status).toBe(200);
    const wb = await openWorkbook(res.body);
    expect(column(wb.getWorksheet('Sales Pipeline'), 'Contact')).toEqual(['Mine']);
  });

  it('refuses a role with no dashboard, and an anonymous caller', async () => {
    /* The route is gated on kpi.read, which a technician does not hold. */
    expect((await get(techToken)).status).toBe(403);
    expect((await request(app).get('/api/reports/export.xlsx')).status).toBe(401);
  });

  it('answers 400 on a malformed window', async () => {
    expect((await get(adminToken, '?from=whenever')).status).toBe(400);
  });
});
