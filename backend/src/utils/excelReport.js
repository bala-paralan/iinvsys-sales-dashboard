'use strict';
/**
 * excelReport.js — the monthly workbook, rebuilt for the three-process model.
 *
 * What the previous version did, and why none of it survived:
 *
 *   · **N+1 per agent.** `Agent.find()` then `Lead.find({assignedAgent})` inside
 *     the loop — 40 agents meant 41 round trips, and every lead document was
 *     pulled into memory to be counted. Now one `$group` per sheet.
 *   · **No scoping.** It always exported EVERY lead. An agent who could reach
 *     `POST /api/reports/send` mailed themselves the entire company pipeline.
 *     `scope` is now an explicit argument and the caller must supply it.
 *   · **Sales only.** Delivery and Installation did not exist when it was
 *     written, so a "monthly performance review" covered a third of the
 *     business and none of the SLAs the framework actually sets targets on.
 *
 * Sheets: KPI Summary · Sales Pipeline · Agent Performance · Delivery ·
 * Installation & CS · Delay Reason Codes (D-10).
 */
const ExcelJS = require('exceljs');
const pipeline = require('../config/pipeline');
const kpiService = require('./../services/kpiService');

const {
  WON_STAGE, LOST_STAGE, TERMINAL_SALES_STAGES,
} = pipeline;

/* ── styling ─────────────────────────────────────────────────────────────── */

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3C5E' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const ALT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4F8' } };

const STATUS_FILL = {
  ok:     { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD7F0DB' } },
  warn:   { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF0CE' } },
  breach: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } },
};

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF2980b9' } } };
  });
  row.height = 22;
  row.commit();
}

function styleDataRow(row, idx) {
  if (idx % 2 === 0) row.eachCell((cell) => { cell.fill = ALT_FILL; });
  row.eachCell((cell) => { cell.alignment = { vertical: 'middle' }; });
  row.height = 18;
}

const date = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');
const label = (list, key) => {
  const hit = (list || []).find((x) => x.key === key);
  return hit ? hit.label : (key || '—');
};

/* ── Sheet 1: KPI Summary ────────────────────────────────────────────────── */

/**
 * The sheet the monthly review actually opens. Every number here is the same
 * one `/api/kpis/*` serves — the export calls the KPI service rather than
 * recomputing, because two implementations of "win rate" is one too many.
 */
function buildKpiSheet(ws, groups, window) {
  ws.columns = [
    { header: 'Process', key: 'process', width: 16 },
    { header: 'KPI', key: 'label', width: 34 },
    { header: 'Actual', key: 'actual', width: 14 },
    { header: 'Target', key: 'target', width: 12 },
    { header: 'Unit', key: 'unit', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Numerator', key: 'numerator', width: 12 },
    { header: 'Denominator', key: 'denominator', width: 13 },
  ];
  styleHeader(ws.getRow(1));

  let i = 0;
  for (const [process, metrics] of Object.entries(groups)) {
    for (const m of metrics) {
      const row = ws.addRow({
        process,
        label: m.label,
        /* An unmeasured KPI says so. A blank cell reads as zero, and zero is a
           claim — "no on-time deliveries" rather than "no deliveries". */
        actual: m.actual == null ? 'no data' : m.actual,
        target: m.target == null ? '—' : m.target,
        unit: m.unit,
        status: m.status || '—',
        numerator: m.numerator == null ? '—' : m.numerator,
        denominator: m.denominator == null ? '—' : m.denominator,
      });
      styleDataRow(row, i);
      if (m.status && STATUS_FILL[m.status]) row.getCell('status').fill = STATUS_FILL[m.status];
      i += 1;
    }
  }

  ws.getCell(`A${ws.rowCount + 2}`).value = `Window: ${window.label} (Asia/Kolkata)`;
  ws.autoFilter = { from: 'A1', to: 'H1' };
}

/* ── Sheet 2: Sales Pipeline ─────────────────────────────────────────────── */

async function buildLeadsSheet(ws, Lead, scope) {
  ws.columns = [
    { header: 'Opportunity', key: 'opportunity', width: 34 },
    { header: 'Contact', key: 'name', width: 20 },
    { header: 'Phone', key: 'phone', width: 15 },
    { header: 'Company', key: 'company', width: 22 },
    { header: 'Company Type', key: 'companyType', width: 18 },
    { header: 'Zone', key: 'zone', width: 10 },
    { header: 'Stage', key: 'stage', width: 18 },
    { header: 'Source', key: 'source', width: 20 },
    { header: 'Value (₹)', key: 'value', width: 15 },
    { header: 'Probability %', key: 'probability', width: 13 },
    { header: 'SPENCO', key: 'spenco', width: 10 },
    { header: 'Expected Close', key: 'close', width: 15 },
    { header: 'Next Follow-up', key: 'followUp', width: 15 },
    { header: 'Agent', key: 'agent', width: 18 },
    { header: 'Needs Review', key: 'review', width: 30 },
  ];
  styleHeader(ws.getRow(1));

  const leads = await Lead.find(scope.leadFilter)
    .populate('assignedAgent', 'name')
    .sort({ createdAt: -1 })
    .lean();

  leads.forEach((l, i) => {
    const row = ws.addRow({
      opportunity: l.opportunityName || '—',
      name: l.name,
      phone: l.phone || '—',
      company: l.company || '—',
      companyType: label(pipeline.COMPANY_TYPES, l.companyType),
      zone: label(pipeline.ZONES, l.zone),
      stage: pipeline.stageLabel(pipeline.SALES_STAGES, l.stage) || l.stage,
      source: label(pipeline.LEAD_SOURCES, l.source),
      value: l.value || 0,
      probability: l.probability == null ? '—' : l.probability,
      spenco: l.spenco && l.spenco.total ? `${l.spenco.total}/30` : '—',
      close: date(l.expectedCloseDate),
      followUp: date(l.nextFollowUpDate),
      agent: (l.assignedAgent && l.assignedAgent.name) || '—',
      review: (l.reviewIssues || []).join(', ') || '',
    });
    styleDataRow(row, i);
  });

  ws.autoFilter = { from: 'A1', to: 'O1' };
}

/* ── Sheet 3: Agent Performance ──────────────────────────────────────────── */

/**
 * One aggregation for every agent, replacing a query per agent plus a full
 * document scan. `$group` on `assignedAgent` gives all six figures in a single
 * pass over the index.
 */
async function buildAgentSheet(ws, Agent, Lead, scope) {
  ws.columns = [
    { header: 'Agent', key: 'agent', width: 22 },
    { header: 'Territory', key: 'territory', width: 18 },
    { header: 'Total Leads', key: 'total', width: 13 },
    { header: 'Won', key: 'won', width: 9 },
    { header: 'Lost', key: 'lost', width: 9 },
    { header: 'Win Rate %', key: 'conv', width: 13 },
    { header: 'Open Pipeline (₹)', key: 'pipeline', width: 19 },
    { header: 'Won Value (₹)', key: 'wonVal', width: 17 },
    { header: 'Target (₹)', key: 'target', width: 15 },
    { header: 'Target Achieved %', key: 'tgtPct', width: 18 },
  ];
  styleHeader(ws.getRow(1));

  const agents = await Agent.find(scope.agentFilter).lean();
  if (!agents.length) return;

  const rows = await Lead.aggregate([
    { $match: { ...scope.leadFilter, assignedAgent: { $in: agents.map((a) => a._id) } } },
    {
      $group: {
        _id: '$assignedAgent',
        total: { $sum: 1 },
        won: { $sum: { $cond: [{ $eq: ['$stage', WON_STAGE] }, 1, 0] } },
        lost: { $sum: { $cond: [{ $eq: ['$stage', LOST_STAGE] }, 1, 0] } },
        wonValue: {
          $sum: { $cond: [{ $eq: ['$stage', WON_STAGE] }, { $ifNull: ['$value', 0] }, 0] },
        },
        openValue: {
          $sum: {
            $cond: [
              { $in: ['$stage', TERMINAL_SALES_STAGES] }, 0, { $ifNull: ['$value', 0] }],
          },
        },
      },
    },
  ]);
  const byAgent = new Map(rows.map((r) => [String(r._id), r]));

  agents.forEach((a, i) => {
    const s = byAgent.get(String(a._id)) || { total: 0, won: 0, lost: 0, wonValue: 0, openValue: 0 };
    const row = ws.addRow({
      agent: a.name,
      territory: a.territory || '—',
      total: s.total,
      won: s.won,
      lost: s.lost,
      /* Blank, not 0.0%, for an agent with no leads — a new joiner has not
         achieved a 0% win rate, they have not had the chance to win yet. */
      conv: s.total ? Math.round((s.won / s.total) * 1000) / 10 : '—',
      pipeline: s.openValue,
      wonVal: s.wonValue,
      target: a.target || 0,
      tgtPct: a.target ? Math.round((s.wonValue / a.target) * 1000) / 10 : '—',
    });
    styleDataRow(row, i);
  });

  ws.autoFilter = { from: 'A1', to: 'J1' };
}

/* ── Sheet 4: Delivery ───────────────────────────────────────────────────── */

async function buildDeliverySheet(ws, WorkOrder) {
  ws.columns = [
    { header: 'Work Order', key: 'wo', width: 18 },
    { header: 'Customer', key: 'customer', width: 24 },
    { header: 'Zone', key: 'zone', width: 10 },
    { header: 'Stage', key: 'stage', width: 22 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Accepted', key: 'accepted', width: 14 },
    { header: 'Committed (original)', key: 'original', width: 19 },
    { header: 'Committed (current)', key: 'current', width: 19 },
    { header: 'Dispatched', key: 'dispatched', width: 14 },
    { header: 'Delivered', key: 'delivered', width: 14 },
    { header: 'On Time', key: 'onTime', width: 11 },
    { header: 'Delays', key: 'delays', width: 9 },
    { header: 'Late Notices', key: 'late', width: 13 },
    { header: 'Discrepancies', key: 'disc', width: 26 },
    { header: 'Damage', key: 'damage', width: 10 },
  ];
  styleHeader(ws.getRow(1));

  const orders = await WorkOrder.find({}).sort({ createdAt: -1 }).lean();

  orders.forEach((w, i) => {
    const delays = w.delayEvents || [];
    const row = ws.addRow({
      wo: w.woNumber,
      customer: w.customerSnapshot ? (w.customerSnapshot.company || w.customerSnapshot.name) : '—',
      zone: w.customerSnapshot ? label(pipeline.ZONES, w.customerSnapshot.zone) : '—',
      stage: pipeline.stageLabel(pipeline.DELIVERY_STAGES, w.stage) || w.stage,
      status: w.status,
      accepted: date(w.acceptedAt),
      original: date(w.originalCommittedDate),
      current: date(w.currentCommittedDate),
      dispatched: date(w.dispatchedAt),
      delivered: date(w.deliveredAt),
      /* Only a delivered order can be on time or late. An open one is neither,
         and marking it "No" would count it as a miss it has not made yet. */
      onTime: !w.deliveredAt || !w.originalCommittedDate ? '—'
        : (w.deliveredAt <= w.originalCommittedDate ? 'Yes' : 'No'),
      delays: delays.length,
      late: delays.filter((d) => d.noticeHours < pipeline.DELAY_NOTICE_MIN_HOURS).length,
      disc: ((w.deliveryAccuracy && w.deliveryAccuracy.discrepancies) || []).join('; ') || '',
      damage: w.damageReported ? 'Yes' : 'No',
    });
    styleDataRow(row, i);
  });

  ws.autoFilter = { from: 'A1', to: 'O1' };
}

/* ── Sheet 5: Delay Reason Codes (D-10) ──────────────────────────────────── */

/**
 * The framework asks for a *monthly performance review of delay reason codes*.
 * That is this sheet: one row per code, with how often notice was late — the
 * pattern a manager acts on, which no per-order listing makes visible.
 */
async function buildDelaySheet(ws, WorkOrder, window) {
  ws.columns = [
    { header: 'Reason Code', key: 'code', width: 30 },
    { header: 'Delays', key: 'count', width: 10 },
    { header: '% of Delays', key: 'pct', width: 14 },
    { header: 'Late Notices (<48h)', key: 'late', width: 19 },
    { header: 'Mean Notice (h)', key: 'meanNotice', width: 16 },
    { header: 'Mean Slip (days)', key: 'meanSlip', width: 17 },
  ];
  styleHeader(ws.getRow(1));

  const rows = await WorkOrder.aggregate([
    { $unwind: '$delayEvents' },
    { $match: { 'delayEvents.at': { $gte: window.from, $lt: window.to } } },
    {
      $group: {
        _id: '$delayEvents.reasonCode',
        count: { $sum: 1 },
        late: {
          $sum: {
            $cond: [{ $lt: ['$delayEvents.noticeHours', pipeline.DELAY_NOTICE_MIN_HOURS] }, 1, 0],
          },
        },
        meanNotice: { $avg: '$delayEvents.noticeHours' },
        meanSlip: {
          $avg: {
            $divide: [
              { $subtract: ['$delayEvents.revisedDate', '$delayEvents.previousDate'] },
              86400000,
            ],
          },
        },
      },
    },
    { $sort: { count: -1 } },
  ]);

  const total = rows.reduce((s, r) => s + r.count, 0);

  rows.forEach((r, i) => {
    const row = ws.addRow({
      code: label(pipeline.DELAY_REASON_CODES, r._id),
      count: r.count,
      pct: total ? Math.round((r.count / total) * 1000) / 10 : 0,
      late: r.late,
      meanNotice: Math.round(r.meanNotice * 10) / 10,
      meanSlip: Math.round(r.meanSlip * 10) / 10,
    });
    styleDataRow(row, i);
  });

  if (!rows.length) ws.addRow({ code: `No delays recorded in ${window.label}` });
  ws.autoFilter = { from: 'A1', to: 'F1' };
}

/* ── Sheet 6: Installation & Customer Service ────────────────────────────── */

async function buildInstallationSheet(ws, InstallationJob, scope) {
  ws.columns = [
    { header: 'Job', key: 'job', width: 18 },
    { header: 'Customer', key: 'customer', width: 24 },
    { header: 'Technician', key: 'tech', width: 18 },
    { header: 'Stage', key: 'stage', width: 22 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Scheduled', key: 'scheduled', width: 14 },
    { header: 'Completed (I2)', key: 'completed', width: 15 },
    { header: 'First-Time Right', key: 'ftr', width: 16 },
    { header: 'Retests', key: 'retests', width: 10 },
    { header: 'Open Snags', key: 'snags', width: 12 },
    { header: 'Handover', key: 'handover', width: 14 },
    { header: 'Open Issues', key: 'issues', width: 12 },
    { header: 'Feedback Sent', key: 'sent', width: 14 },
    { header: 'Feedback In', key: 'received', width: 14 },
    { header: 'CSAT', key: 'csat', width: 9 },
    { header: 'Corrective Action', key: 'corrective', width: 20 },
  ];
  styleHeader(ws.getRow(1));

  const jobs = await InstallationJob.find(scope.installFilter).sort({ createdAt: -1 }).lean();

  jobs.forEach((j, i) => {
    const openSnags = (j.snags || []).filter((s) => !s.closedAt);
    const openIssues = ((j.postSupport && j.postSupport.issues) || []).filter((x) => !x.resolvedAt);
    const ca = j.correctiveAction || {};
    const row = ws.addRow({
      job: j.jobNumber,
      customer: j.customerSnapshot ? (j.customerSnapshot.company || j.customerSnapshot.name) : '—',
      tech: j.technicianName || '—',
      stage: pipeline.stageLabel(pipeline.INSTALL_STAGES, j.stage) || j.stage,
      status: j.status,
      scheduled: date(j.scheduledDate),
      completed: date(j.completedAt),
      ftr: j.firstTimeRight == null ? '—' : (j.firstTimeRight ? 'Yes' : 'No'),
      retests: (j.commissioning && j.commissioning.retestCount) || 0,
      snags: openSnags.length,
      handover: date(j.handover && j.handover.handedOverAt),
      issues: openIssues.length,
      sent: date(j.feedback && j.feedback.dispatchedAt),
      received: date(j.feedback && j.feedback.receivedAt),
      csat: (j.feedback && j.feedback.csat) == null ? '—' : j.feedback.csat,
      /* Three distinct states, not two: not required, required and done,
         required and OUTSTANDING — the last is the one that blocks closure. */
      corrective: !ca.required ? '—' : (ca.documentedAt ? `Documented ${date(ca.documentedAt)}` : 'OUTSTANDING'),
    });
    styleDataRow(row, i);
    if (ca.required && !ca.documentedAt) row.getCell('corrective').fill = STATUS_FILL.breach;
  });

  ws.autoFilter = { from: 'A1', to: 'P1' };
}

/* ── scope ───────────────────────────────────────────────────────────────── */

/**
 * Translate a user into what they may export.
 *
 * Explicit and required: the old export silently included every lead in the
 * database regardless of who asked for it. An agent must see their own leads
 * and nothing else, and the delivery/installation sheets are omitted entirely
 * rather than scoped, because an agent holds no `workorder.read`.
 */
function scopeFor(user) {
  if (!user) throw new Error('excelReport: a user is required to scope the export');
  const { can } = require('../middleware/rbac');

  const agentScoped = user.role === 'agent' && user.agentId;
  /* A technician holds install.read, so without this they would export EVERY
     job in the company — while `GET /api/installations` shows them only their
     own. An export that is broader than the screen it summarises is a leak. */
  const techScoped = user.role === 'technician';

  return {
    leadFilter: agentScoped ? { assignedAgent: user.agentId } : {},
    agentFilter: agentScoped ? { _id: user.agentId } : {},
    installFilter: techScoped ? { technician: user._id } : {},
    sales: can(user, 'lead.read'),
    delivery: can(user, 'workorder.read') && !agentScoped,
    installation: can(user, 'install.read') && !agentScoped,
    kpis: can(user, 'kpi.read'),
  };
}

/* ── public ──────────────────────────────────────────────────────────────── */

/**
 * @param {object} opts
 * @param {object} opts.user   the requesting user — REQUIRED, scopes the export
 * @param {object} [opts.query] `?from=&to=&period=` for the reporting window
 */
async function generateReportBuffer(opts = {}) {
  const Agent = require('../models/Agent');
  const Lead = require('../models/Lead');
  const WorkOrder = require('../models/WorkOrder');
  const InstallationJob = require('../models/InstallationJob');

  const { user, query = {} } = opts;
  const scope = scopeFor(user);
  const window = kpiService.resolveWindow(query);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'IINVSYS';
  wb.created = new Date();
  wb.modified = new Date();

  if (scope.kpis) {
    const groups = {};
    if (scope.sales) groups.Sales = await kpiService.salesKpis(window);
    if (scope.delivery) groups.Delivery = await kpiService.deliveryKpis(window);
    if (scope.installation) groups.Installation = await kpiService.installationKpis(window);
    if (Object.keys(groups).length) {
      buildKpiSheet(wb.addWorksheet('KPI Summary'), groups, window);
    }
  }

  if (scope.sales) {
    await buildLeadsSheet(wb.addWorksheet('Sales Pipeline'), Lead, scope);
    await buildAgentSheet(wb.addWorksheet('Agent Performance'), Agent, Lead, scope);
  }
  if (scope.delivery) {
    await buildDeliverySheet(wb.addWorksheet('Delivery'), WorkOrder);
    await buildDelaySheet(wb.addWorksheet('Delay Reason Codes'), WorkOrder, window);
  }
  if (scope.installation) {
    await buildInstallationSheet(wb.addWorksheet('Installation & CS'), InstallationJob, scope);
  }

  /* ExcelJS refuses to write a workbook with no sheets, and a role with no
     export rights should get a clear refusal rather than a corrupt file. */
  if (!wb.worksheets.length) {
    const err = new Error('This role has nothing it may export');
    err.code = 'EXPORT_EMPTY_SCOPE';
    throw err;
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { generateReportBuffer, scopeFor };
