'use strict';
const cron = require('node-cron');

let _task = null;

/**
 * Map periodicity + sendTime to a cron expression.
 * sendTime is "HH:MM" (24-h).
 */
function buildCron(periodicity, sendTime) {
  const [hh, mm] = (sendTime || '08:00').split(':').map(Number);
  switch (periodicity) {
    case 'daily':   return `${mm} ${hh} * * *`;
    case 'weekly':  return `${mm} ${hh} * * 1`;   // Every Monday
    case 'monthly': return `${mm} ${hh} 1 * *`;   // 1st of month
    default:        return null;
  }
}

async function runScheduledReport() {
  try {
    const EmailConfig = require('../models/EmailConfig');
    const { generateReportBuffer } = require('./excelReport');
    const { sendReportEmail }      = require('./emailService');

    const cfg = await EmailConfig.findOne({}).lean();
    if (!cfg || cfg.periodicity === 'disabled' || !cfg.recipients.length) return;

    const buffer = await generateReportBuffer();
    const result = await sendReportEmail({
      recipients:  cfg.recipients,
      template:    cfg.template,
      periodicity: cfg.periodicity,
      excelBuffer: buffer,
    });

    await EmailConfig.findOneAndUpdate({}, { lastSentAt: new Date() });
    console.log(`📧  Report sent → ${result.recipients} recipient(s): "${result.subject}"`);
  } catch (err) {
    console.error('Scheduled report failed:', err.message);
  }
}

/**
 * Call once after DB is connected.
 * Reads config from DB and schedules (or skips if disabled).
 * Safe to call again — destroys previous task first.
 */
async function initScheduler() {
  if (_task) { _task.destroy(); _task = null; }

  try {
    const EmailConfig = require('../models/EmailConfig');
    const cfg = await EmailConfig.findOne({}).lean();
    if (!cfg || cfg.periodicity === 'disabled') {
      console.log('📅  Email scheduler: disabled');
      return;
    }

    const expression = buildCron(cfg.periodicity, cfg.sendTime);
    if (!expression || !cron.validate(expression)) {
      console.warn('📅  Email scheduler: invalid cron expression, skipping');
      return;
    }

    _task = cron.schedule(expression, runScheduledReport, { timezone: 'Asia/Kolkata' });
    console.log(`📅  Email scheduler: ${cfg.periodicity} at ${cfg.sendTime} IST (${expression})`);
  } catch (err) {
    console.error('Scheduler init failed:', err.message);
  }
}

module.exports = { initScheduler, runScheduledReport };
