'use strict';
const EmailConfig           = require('../models/EmailConfig');
const {
  WON_STAGE, SALES_STAGE_KEYS, SALES_STAGES, stageLabel,
} = require('../config/pipeline');
const { generateReportBuffer } = require('../utils/excelReport');
const { sendReportEmail }      = require('../utils/emailService');
const { ok }                   = require('../utils/response');

/* ── helpers ── */
async function getOrCreateConfig() {
  let cfg = await EmailConfig.findOne({});
  if (!cfg) cfg = await EmailConfig.create({});
  return cfg;
}

/* GET /api/reports/config
   superadmin only */
async function getConfig(req, res, next) {
  try {
    const cfg = await getOrCreateConfig();
    return ok(res, cfg, 'Report config fetched');
  } catch (err) { next(err); }
}

/* PUT /api/reports/config
   Body: { recipients?, periodicity?, sendTime?, template? }
   superadmin only */
async function updateConfig(req, res, next) {
  try {
    const { recipients, periodicity, sendTime, template } = req.body;

    const cfg = await getOrCreateConfig();

    if (Array.isArray(recipients)) {
      // Validate emails
      const invalid = recipients.filter(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
      if (invalid.length) {
        return res.status(400).json({ success: false, message: `Invalid email(s): ${invalid.join(', ')}` });
      }
      cfg.recipients = recipients.map(e => e.trim().toLowerCase());
    }

    if (periodicity !== undefined) {
      const allowed = ['disabled', 'daily', 'weekly', 'monthly'];
      if (!allowed.includes(periodicity)) {
        return res.status(400).json({ success: false, message: 'Invalid periodicity' });
      }
      cfg.periodicity = periodicity;
    }

    if (sendTime !== undefined) {
      if (!/^\d{2}:\d{2}$/.test(sendTime)) {
        return res.status(400).json({ success: false, message: 'sendTime must be HH:MM' });
      }
      cfg.sendTime = sendTime;
    }

    if (template && typeof template === 'object') {
      if (template.subject !== undefined) cfg.template.subject = template.subject;
      if (template.body    !== undefined) cfg.template.body    = template.body;
    }

    cfg.updatedBy = req.user._id;
    await cfg.save();

    // Re-initialise scheduler with new config (only in non-test envs)
    if (process.env.NODE_ENV !== 'test') {
      const { initScheduler } = require('../utils/scheduler');
      initScheduler().catch(() => {});
    }

    return ok(res, cfg, 'Report config updated');
  } catch (err) { next(err); }
}

/* POST /api/reports/send
   Trigger an immediate send (superadmin / manager)  */
async function sendNow(req, res, next) {
  try {
    const cfg = await getOrCreateConfig();

    if (!cfg.recipients.length) {
      return res.status(400).json({ success: false, message: 'No recipients configured' });
    }

    // Step 1: build Excel
    let buffer;
    try {
      buffer = await generateReportBuffer({ user: req.user, query: req.query });
    } catch (excelErr) {
      if (excelErr.code === 'EXPORT_EMPTY_SCOPE') {
        return res.status(403).json({ success: false, message: excelErr.message });
      }
      return res.status(500).json({ success: false, message: `Excel generation failed: ${excelErr.message}` });
    }

    // Step 2: send email
    let result;
    try {
      result = await sendReportEmail({
        recipients:  cfg.recipients,
        template:    cfg.template,
        periodicity: cfg.periodicity === 'disabled' ? 'daily' : cfg.periodicity,
        excelBuffer: buffer,
      });
    } catch (mailErr) {
      return res.status(503).json({ success: false, message: `Email delivery failed: ${mailErr.message}` });
    }

    cfg.lastSentAt = new Date();
    await cfg.save();

    return ok(res, {
      subject:    result.subject,
      recipients: result.recipients,
      filename:   result.filename,
      sentAt:     cfg.lastSentAt,
    }, `Report sent to ${result.recipients} recipient(s)`);
  } catch (err) { next(err); }
}

/* GET /api/reports/preview
   The JSON behind the workbook, scoped like the workbook. superadmin/manager */
async function previewData(req, res, next) {
  try {
    const User  = require('../models/User');
    const Lead  = require('../models/Lead');
    const kpiService = require('../services/kpiService');
    const { scopeFor } = require('../utils/excelReport');

    /* Async since it moved onto services/scopeService.js — a team scope needs one
       indexed User lookup to resolve the subtree. */
    const scope = await scopeFor(req.user);
    let window;
    try {
      window = kpiService.resolveWindow(req.query);
    } catch (err) {
      if (err instanceof RangeError) return res.status(400).json({ success: false, message: err.message });
      throw err;
    }

    /* One aggregation, not one query per agent. The previous implementation
       ran `Lead.find({owner})` inside a loop and counted in JS — 40
       agents was 41 round trips and a full document scan each time. */
    const agents = await User.find(scope.agentFilter).lean();
    const grouped = await Lead.aggregate([
      { $match: { ...scope.leadFilter, owner: { $in: agents.map((a) => a._id) } } },
      {
        $group: {
          _id: '$owner',
          totalLeads: { $sum: 1 },
          won: { $sum: { $cond: [{ $eq: ['$stage', WON_STAGE] }, 1, 0] } },
          wonValue: { $sum: { $cond: [{ $eq: ['$stage', WON_STAGE] }, { $ifNull: ['$value', 0] }, 0] } },
        },
      },
    ]);
    const byAgent = new Map(grouped.map((g) => [String(g._id), g]));

    const agentStats = agents.map((a) => {
      const g = byAgent.get(String(a._id)) || { totalLeads: 0, won: 0, wonValue: 0 };
      return {
        name: a.name,
        territory: a.territory,
        totalLeads: g.totalLeads,
        won: g.won,
        wonValue: g.wonValue,
        target: a.target,
        /* null, not "0.0", for an agent with no leads — see the same note in
           excelReport.js. A new joiner has not achieved a 0% win rate. */
        convRate: g.totalLeads ? Math.round((g.won / g.totalLeads) * 1000) / 10 : null,
      };
    });

    /* The whole funnel in one pass instead of two queries per stage. */
    const funnelRows = await Lead.aggregate([
      { $match: scope.leadFilter },
      { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: { $ifNull: ['$value', 0] } } } },
    ]);
    const byStage = new Map(funnelRows.map((r) => [r._id, r]));
    const totalLeads = funnelRows.reduce((sum, r) => sum + r.count, 0);
    const funnel = SALES_STAGE_KEYS.map((stage) => {
      const r = byStage.get(stage) || { count: 0, value: 0 };
      return {
        stage,
        label: stageLabel(SALES_STAGES, stage),
        count: r.count,
        value: r.value,
        pct: totalLeads ? Math.round((r.count / totalLeads) * 1000) / 10 : 0,
      };
    });

    const kpis = {};
    if (scope.kpis && scope.sales) kpis.sales = await kpiService.salesKpis(window);
    if (scope.kpis && scope.delivery) kpis.delivery = await kpiService.deliveryKpis(window);
    if (scope.kpis && scope.installation) kpis.installation = await kpiService.installationKpis(window);

    const cfg = await getOrCreateConfig();

    return ok(res, {
      generatedAt: new Date().toISOString(),
      window: { from: window.from, to: window.to, label: window.label },
      sheets: Object.entries(scope)
        .filter(([k, v]) => v === true && k !== 'kpis')
        .map(([k]) => k),
      agentStats,
      funnel,
      totalLeads,
      kpis,
      config: {
        periodicity: cfg.periodicity,
        recipients:  cfg.recipients.length,
        lastSentAt:  cfg.lastSentAt,
      },
    }, 'Preview data');
  } catch (err) { next(err); }
}

/* GET /api/reports/export.xlsx
   Download the workbook directly. The report was previously reachable ONLY by
   emailing it to a configured recipient list, so a manager could not simply
   look at this month's numbers without first becoming a mail recipient. */
async function downloadReport(req, res, next) {
  try {
    const buffer = await generateReportBuffer({ user: req.user, query: req.query });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename="IINVSYS-report-${stamp}.xlsx"`);
    return res.send(Buffer.from(buffer));
  } catch (err) {
    if (err.code === 'EXPORT_EMPTY_SCOPE') {
      return res.status(403).json({ success: false, message: err.message });
    }
    if (err instanceof RangeError) {
      return res.status(400).json({ success: false, message: err.message });
    }
    return next(err);
  }
}

module.exports = { getConfig, updateConfig, sendNow, previewData, downloadReport };
