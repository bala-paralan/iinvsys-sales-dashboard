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

    /* The nightly report has no requesting user, so it runs as a synthetic
       superadmin — stated explicitly rather than defaulting to unscoped, which
       is how the old export came to mail the whole pipeline to everyone. */
    const buffer = await generateReportBuffer({
      user: { role: 'superadmin', name: 'Scheduled report' },
    });
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

/* ══════════════════════════════════════════════════════════════════════════
   Nightly sweeps — S-7, C-5
   ══════════════════════════════════════════════════════════════════════════ */

let _sweepTasks = [];

/**
 * The framework's automation is stated in wall-clock terms ("auto-flag to
 * Sales Manager", "one note per week"), so the sweeps run on a clock rather
 * than on writes. 07:00 IST puts the result in a manager's inbox before the
 * working day rather than during it.
 *
 * Each job is a plain async function returning a summary; the cron wrapper
 * only handles scheduling and logging. That split is what lets the jobs be
 * tested directly, with an injected `now`, instead of by waiting for a clock.
 */
const SWEEPS = [
  {
    name: 'sales hygiene + inactivity',
    expression: '0 7 * * *',        // 07:00 IST daily
    run: async () => {
      const { runNightly } = require('./jobs/salesHygiene');
      const r = await runNightly();
      console.log(`🧹  Sales sweep: ${r.hygiene.changed}/${r.hygiene.scanned} re-flagged · `
        + `${r.inactivity.flagged} inactive (${r.inactivity.notified} alerts, `
        + `${r.inactivity.suppressed} suppressed) · ${r.notes.flagged} needing a note`);
    },
  },
  {
    name: 'installation & CS clocks',
    expression: '30 7 * * *',        // 07:30 IST daily, after the sales sweep
    run: async () => {
      const { runInstallationSweeps } = require('./jobs/installationSweeps');
      const r = await runInstallationSweeps();
      console.log(`🔧  Install sweep: ${r.checkIn.flagged} check-ins due · `
        + `${r.feedback.dispatched} forms dispatched, ${r.feedback.reminded} reminded · `
        + `${r.issues.flagged} issues past SLA · ${r.corrective.flagged} corrective plans overdue`);
    },
  },
  {
    name: 'delivery SLA clocks',
    /* Hourly during the working day, not nightly: a 1-business-day SLA that is
       only checked every 24h can be breached for a full day before anyone is
       told. 09:00–19:00 IST covers the delivery team's hours. */
    expression: '15 9-19 * * *',
    run: async () => {
      const { runDeliverySweeps } = require('./jobs/deliverySweeps');
      const r = await runDeliverySweeps();
      if (r.unaccepted.flagged || r.dateUnconfirmed.flagged) {
        console.log(`🚚  Delivery sweep: ${r.unaccepted.flagged} unaccepted, `
          + `${r.dateUnconfirmed.flagged} without a committed date`);
      }
    },
  },
];

function initSweeps() {
  _sweepTasks.forEach((t) => t.destroy());
  _sweepTasks = [];

  /* Never under test: a cron firing mid-suite would mutate the database
     underneath whatever assertion is running. */
  if (process.env.NODE_ENV === 'test') return;

  for (const sweep of SWEEPS) {
    if (!cron.validate(sweep.expression)) {
      console.warn(`📅  Sweep "${sweep.name}": invalid expression, skipping`);
      continue;
    }
    _sweepTasks.push(cron.schedule(sweep.expression, async () => {
      try {
        await sweep.run();
      } catch (err) {
        /* A failed sweep must never take the process down — it is a background
           report, not a request path. */
        console.error(`Sweep "${sweep.name}" failed:`, err.message);
      }
    }, { timezone: 'Asia/Kolkata' }));
    console.log(`📅  Sweep scheduled: ${sweep.name} (${sweep.expression} IST)`);
  }
}

module.exports = { initScheduler, runScheduledReport, initSweeps, SWEEPS };
