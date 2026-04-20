'use strict';
const EmailConfig           = require('../models/EmailConfig');
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
        return res.status(400).json({ success: false, error: `Invalid email(s): ${invalid.join(', ')}` });
      }
      cfg.recipients = recipients.map(e => e.trim().toLowerCase());
    }

    if (periodicity !== undefined) {
      const allowed = ['disabled', 'daily', 'weekly', 'monthly'];
      if (!allowed.includes(periodicity)) {
        return res.status(400).json({ success: false, error: 'Invalid periodicity' });
      }
      cfg.periodicity = periodicity;
    }

    if (sendTime !== undefined) {
      if (!/^\d{2}:\d{2}$/.test(sendTime)) {
        return res.status(400).json({ success: false, error: 'sendTime must be HH:MM' });
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
      return res.status(400).json({ success: false, error: 'No recipients configured' });
    }

    // Step 1: build Excel
    let buffer;
    try {
      buffer = await generateReportBuffer();
    } catch (excelErr) {
      return res.status(500).json({ success: false, error: `Excel generation failed: ${excelErr.message}` });
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
      return res.status(503).json({ success: false, error: `Email delivery failed: ${mailErr.message}` });
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
   Returns the data that would appear in the Excel (JSON, no attachment)
   superadmin / manager */
async function previewData(req, res, next) {
  try {
    const Agent = require('../models/Agent');
    const Lead  = require('../models/Lead');

    // Summary per agent
    const agents = await Agent.find({}).lean();
    const agentStats = await Promise.all(
      agents.map(async (a) => {
        const leads = await Lead.find({ assignedAgent: a._id }).lean();
        const won   = leads.filter(l => l.stage === 'won');
        const wonValue = won.reduce((s, l) => s + (l.value || 0), 0);
        return {
          name:       a.name,
          territory:  a.territory,
          totalLeads: leads.length,
          won:        won.length,
          wonValue,
          target:     a.target,
          convRate:   leads.length ? ((won.length / leads.length) * 100).toFixed(1) : '0.0',
        };
      })
    );

    // Stage breakdown
    const stages = ['new','contacted','interested','proposal','negotiation','won','lost'];
    const totalLeads = await Lead.countDocuments();
    const funnel = await Promise.all(
      stages.map(async (s) => {
        const count = await Lead.countDocuments({ stage: s });
        const agg   = await Lead.aggregate([
          { $match: { stage: s } },
          { $group: { _id: null, total: { $sum: '$value' } } },
        ]);
        return {
          stage: s,
          count,
          value: agg[0]?.total || 0,
          pct:   totalLeads ? ((count / totalLeads) * 100).toFixed(1) : '0.0',
        };
      })
    );

    const cfg = await getOrCreateConfig();

    return ok(res, {
      generatedAt: new Date().toISOString(),
      agentStats,
      funnel,
      totalLeads,
      config: {
        periodicity: cfg.periodicity,
        recipients:  cfg.recipients.length,
        lastSentAt:  cfg.lastSentAt,
      },
    }, 'Preview data');
  } catch (err) { next(err); }
}

module.exports = { getConfig, updateConfig, sendNow, previewData };
