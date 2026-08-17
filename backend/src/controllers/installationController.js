'use strict';
/**
 * Installation & Customer Service — Process 3. B3.
 *
 * The closure gate is the point of this module: "a job record cannot be marked
 * Closed until the Customer Feedback Form is received", and when CSAT lands
 * below 3.0 a corrective action plan must be documented BEFORE closure. Every
 * other endpoint here feeds that gate.
 */
const multer = require('multer');
const InstallationJob = require('../models/InstallationJob');
const pipeline = require('../config/pipeline');
const { applyTransition, previewGate } = require('../services/stageService');
const fileStore = require('../utils/fileStore');
const audit = require('../services/auditService');
const { notifyByPermission } = require('../services/notificationService');
const { addBusinessDays } = require('../utils/businessDays');
const { ok, created, notFound, badRequest, unprocessable, gateFailed, paginated } = require('../utils/response');
const { parsePaging } = require('../utils/pagination');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: fileStore.MAX_BYTES },
});

/** Technicians see only their own jobs; other install roles see the queue. */
function technicianScope(req) {
  return req.user.role === 'technician' ? { technician: req.user._id } : {};
}

/* ── GET /api/installations ──────────────────────────────────────────── */

async function listJobs(req, res, next) {
  try {
    const filter = technicianScope(req);
    if (req.query.stage) filter.stage = req.query.stage;
    if (req.query.status) filter.status = req.query.status;

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 100 });
    const [rows, total] = await Promise.all([
      InstallationJob.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      InstallationJob.countDocuments(filter),
    ]);
    return paginated(res, rows, total, page, limit);
  } catch (err) { next(err); }
}

async function getJob(req, res, next) {
  try {
    const job = await InstallationJob.findById(req.params.id).lean();
    if (!job) return notFound(res, 'Installation Job not found');
    /* Technician scoping: 404 rather than 403, so ids cannot be probed. */
    if (req.user.role === 'technician' && String(job.technician) !== String(req.user._id)) {
      return notFound(res, 'Installation Job not found');
    }
    return ok(res, job);
  } catch (err) { next(err); }
}

/* ── POST /api/installations/:id/plan — I1 ───────────────────────────── */

async function planJob(req, res, next) {
  try {
    const { technician, technicianName = '', scheduledDate, siteReadyConfirmedBy, siteReadyNotes = '' } = req.body || {};
    const job = await InstallationJob.findById(req.params.id);
    if (!job) return notFound(res, 'Installation Job not found');

    if (technician) { job.technician = technician; job.technicianName = technicianName; }
    if (scheduledDate) {
      const d = new Date(scheduledDate);
      if (Number.isNaN(d.getTime())) return badRequest(res, 'scheduledDate is not a valid date');
      job.scheduledDate = d;
    }
    /* Site readiness is the CUSTOMER's confirmation, so it records who at the
       customer confirmed it — not the staff member who typed it in. */
    if (siteReadyConfirmedBy) {
      job.siteReady = {
        confirmedAt: new Date(), confirmedBy: siteReadyConfirmedBy, notes: siteReadyNotes,
      };
    }
    await job.save();
    return ok(res, job, 'Installation plan updated');
  } catch (err) { next(err); }
}

/* ── PATCH /api/installations/:id/checklist — I2 ─────────────────────── */

async function updateChecklist(req, res, next) {
  try {
    const { stageKey, itemKey, done = true, signedByName } = req.body || {};
    const job = await InstallationJob.findById(req.params.id);
    if (!job) return notFound(res, 'Installation Job not found');

    const checklist = job.checklists.find((c) => c.stageKey === stageKey);
    if (!checklist) return badRequest(res, `No checklist for stage "${stageKey}"`);

    if (itemKey) {
      const item = checklist.items.find((i) => i.key === itemKey);
      if (!item) return badRequest(res, `No checklist item "${itemKey}"`);
      item.done = !!done;
      item.doneAt = done ? new Date() : null;
      item.doneBy = done ? req.user._id : null;
    }
    /* The technician's signature on the checklist — a separate act from
       ticking the items, and the `checklistSigned` gate tests it separately. */
    if (signedByName !== undefined) {
      checklist.signedByName = signedByName;
      checklist.signedAt = signedByName ? new Date() : null;
    }

    await job.save();
    return ok(res, job, 'Checklist updated');
  } catch (err) { next(err); }
}

/* ── POST /api/installations/:id/snags ───────────────────────────────── */

async function addSnag(req, res, next) {
  try {
    const { severity, description } = req.body || {};
    if (!pipeline.SNAG_SEVERITIES.includes(severity)) {
      return unprocessable(res, `severity must be one of: ${pipeline.SNAG_SEVERITIES.join(', ')}`);
    }
    if (!description || !description.trim()) return badRequest(res, 'A snag needs a description');

    const job = await InstallationJob.findById(req.params.id);
    if (!job) return notFound(res, 'Installation Job not found');

    job.snags.push({ severity, description: description.trim(), reportedBy: req.user._id });
    await job.save();
    return created(res, job.snags.at(-1), 'Snag recorded');
  } catch (err) { next(err); }
}

async function closeSnag(req, res, next) {
  try {
    const job = await InstallationJob.findById(req.params.id);
    if (!job) return notFound(res, 'Installation Job not found');

    const snag = job.snags.id(req.params.snagId);
    if (!snag) return notFound(res, 'Snag not found');

    snag.closedAt = new Date();
    snag.resolution = (req.body && req.body.resolution) || '';
    await job.save();
    return ok(res, snag, 'Snag closed');
  } catch (err) { next(err); }
}

/* ── POST /api/installations/:id/commissioning — I3 ──────────────────── */

async function recordCommissioning(req, res, next) {
  try {
    const { passed, technicianSigned, customerCountersigned, customerSignatory = '', notes = '' } = req.body || {};
    const job = await InstallationJob.findById(req.params.id);
    if (!job) return notFound(res, 'Installation Job not found');

    /* A failed test is a RETEST, and retestCount is what makes
       Commissioning Pass Rate and First-Time-Right measurable. */
    if (passed === false) {
      job.commissioning.retestCount += 1;
      job.commissioning.passed = false;
      await job.save();

      await notifyByPermission(['install.assign', 'lead.gate_override'], {
        event: 'install.commissioning_failed',
        severity: 'warn',
        title: `Commissioning failed on ${job.jobNumber}`,
        body: `${job.customerSnapshot.company || job.customerSnapshot.name} — `
            + `retest #${job.commissioning.retestCount}.`,
        entityType: 'installation', entityId: job._id,
        meta: { retestCount: job.commissioning.retestCount },
      }, { excludeUserId: req.user._id });

      return ok(res, job, `Commissioning failure recorded (retest #${job.commissioning.retestCount})`);
    }

    if (passed === true) job.commissioning.passed = true;
    if (technicianSigned) job.commissioning.technicianSignedAt = new Date();
    if (customerCountersigned) {
      if (!customerSignatory.trim()) {
        return badRequest(res, 'Record who countersigned on behalf of the customer');
      }
      job.commissioning.customerCountersignedAt = new Date();
      job.commissioning.customerSignatory = customerSignatory.trim();
    }
    if (notes) job.commissioning.notes = notes;

    await job.save();
    return ok(res, job, 'Commissioning updated');
  } catch (err) { next(err); }
}

/* ── stage transitions ───────────────────────────────────────────────── */

async function previewJobGate(req, res, next) {
  try {
    const job = await InstallationJob.findById(req.params.id).lean();
    if (!job) return notFound(res, 'Installation Job not found');

    const toStage = req.query.to || pipeline.nextStage(pipeline.INSTALL_STAGES, job.stage);
    if (!toStage) {
      return ok(res, {
        from: job.stage, to: null, allowed: false,
        message: 'Final stage — closure happens through POST /:id/close',
        requirements: [],
      });
    }
    return ok(res, { from: job.stage, to: toStage, ...previewGate(job, pipeline.INSTALL_STAGES, toStage) });
  } catch (err) { next(err); }
}

async function advanceJob(req, res, next) {
  try {
    const { toStage, note = '', patch } = req.body || {};
    if (!toStage) return badRequest(res, 'toStage is required');

    const job = await InstallationJob.findById(req.params.id);
    if (!job) return notFound(res, 'Installation Job not found');

    const result = applyTransition(job, pipeline.INSTALL_STAGES, {
      toStage, patch, note, actor: req.user,
    });
    if (!result.ok) return gateFailed(res, result.code, result.message, result.missing);

    if (job.status === 'open') job.status = 'in_progress';

    /* I2 complete — the anchor for Installation Lead Time (A13), measured to
       completion rather than to "start", which has nothing to measure. */
    if (result.from === 'on_site' && !job.completedAt) {
      job.completedAt = new Date();
      const blocking = job.snags.some(
        (s) => !s.closedAt && pipeline.BLOCKING_SNAG_SEVERITIES.includes(s.severity));
      job.firstTimeRight = job.commissioning.retestCount === 0 && !blocking;
    }

    /* Entering the support window starts the two post-handover clocks. */
    if (result.to === 'post_support') {
      job.status = 'support';
      job.handover.handedOverAt = job.handover.handedOverAt || new Date();
      job.postSupport.checkInDueAt = new Date(
        Date.now() + pipeline.CHECK_IN_DUE_DAYS * 86400000);
    }

    await job.save();

    await audit.stageTransition({
      entityType: 'installation', entityId: job._id,
      from: result.from, to: result.to, direction: result.direction,
      note, label: job.jobNumber,
    }, req);

    return ok(res, {
      job,
      transition: { from: result.from, to: result.to, direction: result.direction },
    }, `Moved to ${pipeline.stageLabel(pipeline.INSTALL_STAGES, result.to)}`);
  } catch (err) { next(err); }
}

/* ── POST /api/installations/:id/handover — I4 ───────────────────────── */

async function recordHandover(req, res, next) {
  try {
    const { trainedAttendees } = req.body || {};
    const job = await InstallationJob.findById(req.params.id);
    if (!job) return notFound(res, 'Installation Job not found');

    if (Array.isArray(trainedAttendees)) job.handover.trainedAttendees = trainedAttendees;

    const verdict = pipeline.validateRequirements(job, pipeline.HANDED_OVER_REQUIRES, new Date());
    if (!verdict.ok) {
      return gateFailed(res, 'HANDOVER_GATE_FAILED',
        `Cannot hand over — ${verdict.missing.length} requirement(s) not met`, verdict.missing);
    }

    job.handover.handedOverAt = new Date();
    job.status = 'handed_over';
    await job.save();

    await notifyByPermission('feedback.log', {
      event: 'install.handover_complete',
      severity: 'info',
      title: `${job.jobNumber} handed over`,
      body: `${job.customerSnapshot.company || job.customerSnapshot.name} — check in within `
          + `${pipeline.CHECK_IN_DUE_DAYS} days; feedback form due within `
          + `${pipeline.FEEDBACK_DISPATCH_DUE_DAYS}.`,
      entityType: 'installation', entityId: job._id,
    });

    return ok(res, job, 'Handover Certificate on file — support window open');
  } catch (err) { next(err); }
}

/* ── support issues — I5 ─────────────────────────────────────────────── */

async function checkIn(req, res, next) {
  try {
    const job = await InstallationJob.findById(req.params.id);
    if (!job) return notFound(res, 'Installation Job not found');
    job.postSupport.checkInDoneAt = new Date();
    await job.save();
    return ok(res, job, 'Proactive check-in recorded');
  } catch (err) { next(err); }
}

async function addIssue(req, res, next) {
  try {
    const { description, severity = 'minor' } = req.body || {};
    if (!description || !description.trim()) return badRequest(res, 'An issue needs a description');

    const job = await InstallationJob.findById(req.params.id);
    if (!job) return notFound(res, 'Installation Job not found');

    job.postSupport.issues.push({
      description: description.trim(), severity, reportedBy: req.user._id,
    });
    await job.save();
    return created(res, job.postSupport.issues.at(-1), 'Issue logged');
  } catch (err) { next(err); }
}

async function resolveIssue(req, res, next) {
  try {
    const job = await InstallationJob.findById(req.params.id);
    if (!job) return notFound(res, 'Installation Job not found');

    const issue = job.postSupport.issues.id(req.params.issueId);
    if (!issue) return notFound(res, 'Issue not found');

    issue.resolvedAt = new Date();
    issue.resolution = (req.body && req.body.resolution) || '';
    const hours = (issue.resolvedAt - issue.reportedAt) / 3600000;
    issue.slaBreached = hours > issue.slaHours;

    await job.save();
    return ok(res, issue, issue.slaBreached
      ? `Issue closed — SLA BREACHED (${Math.round(hours)}h against a ${issue.slaHours}h target)`
      : 'Issue closed');
  } catch (err) { next(err); }
}

/* ── POST /api/installations/:id/feedback — I6 ───────────────────────── */

async function recordFeedback(req, res, next) {
  try {
    const { csat, comments = '' } = req.body || {};
    const score = Number(csat);
    if (!Number.isFinite(score) || score <= 0 || score > pipeline.CSAT_MAX) {
      return unprocessable(res, `CSAT must be between 0 and ${pipeline.CSAT_MAX}`);
    }

    const job = await InstallationJob.findById(req.params.id);
    if (!job) return notFound(res, 'Installation Job not found');

    job.feedback.receivedAt = new Date();
    job.feedback.csat = score;
    job.feedback.comments = comments;

    /* I-6/I-8: below the threshold, a corrective action plan becomes REQUIRED
       and gets a 5-business-day clock. The closure gate then refuses until it
       is documented — the escalation is not advisory. */
    let escalated = false;
    if (score < pipeline.CSAT_ESCALATION_THRESHOLD) {
      job.correctiveAction.required = true;
      job.correctiveAction.dueAt = addBusinessDays(
        new Date(), pipeline.CORRECTIVE_ACTION_SLA_BUSINESS_DAYS);
      escalated = true;
    }
    await job.save();

    if (escalated) {
      await notifyByPermission(['feedback.corrective_action', 'lead.gate_override'], {
        event: 'install.csat_low',
        severity: 'critical',
        title: `CSAT ${score}/${pipeline.CSAT_MAX} on ${job.jobNumber} — corrective action required`,
        body: `${job.customerSnapshot.company || job.customerSnapshot.name}. A documented plan is `
            + `due by ${job.correctiveAction.dueAt.toDateString()}; the job cannot close without it.`,
        entityType: 'installation', entityId: job._id,
        meta: { csat: score, dueAt: job.correctiveAction.dueAt },
      });
    }

    await audit.record({
      action: 'record.update', entityType: 'installation', entityId: job._id,
      summary: `CSAT ${score} recorded on ${job.jobNumber}${escalated ? ' — corrective action required' : ''}`,
      meta: { csat: score, escalated },
    }, req);

    return ok(res, job, escalated
      ? `Feedback recorded — CSAT below ${pipeline.CSAT_ESCALATION_THRESHOLD}, corrective action required before closure`
      : 'Feedback recorded');
  } catch (err) { next(err); }
}

async function recordCorrectiveAction(req, res, next) {
  try {
    const { plan } = req.body || {};
    if (!plan || !plan.trim()) return badRequest(res, 'Describe the corrective action plan');

    const job = await InstallationJob.findById(req.params.id);
    if (!job) return notFound(res, 'Installation Job not found');

    job.correctiveAction.plan = plan.trim();
    job.correctiveAction.documentedAt = new Date();
    await job.save();
    return ok(res, job, 'Corrective action plan documented');
  } catch (err) { next(err); }
}

/* ── POST /api/installations/:id/close — the closure gate ────────────── */

async function closeJob(req, res, next) {
  try {
    const job = await InstallationJob.findById(req.params.id);
    if (!job) return notFound(res, 'Installation Job not found');
    if (job.status === 'closed') return ok(res, job, 'Already closed');

    /* I-7 + I-8. `requiredIfCsatBelow:3` makes the corrective-action plan part
       of the same declarative gate rather than a special case in code. */
    const verdict = pipeline.validateRequirements(job, pipeline.CLOSED_REQUIRES, new Date());
    if (!verdict.ok) {
      return gateFailed(res, 'CLOSURE_GATE_FAILED',
        `Cannot close — ${verdict.missing.length} requirement(s) not met`, verdict.missing);
    }

    job.status = 'closed';
    job.closedAt = new Date();
    await job.save();

    await audit.stageTransition({
      entityType: 'installation', entityId: job._id,
      from: job.stage, to: 'closed', direction: 'forward',
      note: 'Closure gate passed', label: job.jobNumber,
    }, req);

    return ok(res, job, 'Job closed — feedback on file');
  } catch (err) { next(err); }
}

/* ── uploads ─────────────────────────────────────────────────────────── */

async function uploadAttachment(req, res, next) {
  try {
    const { docType } = req.body || {};
    if (!pipeline.DOC_TYPE_KEYS.includes(docType)) {
      return unprocessable(res, `docType must be one of: ${pipeline.DOC_TYPE_KEYS.join(', ')}`);
    }
    if (!req.file) return badRequest(res, 'Attach a file under the field name "file"');

    const job = await InstallationJob.findById(req.params.id);
    if (!job) return notFound(res, 'Installation Job not found');

    const stored = await fileStore.put(req.file.buffer, {
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      docType,
      uploadedBy: req.user._id,
    });

    job.attachments.push({ ...stored, docType, uploadedBy: req.user._id });
    await job.save();
    return created(res, job.attachments.at(-1), `${docType} attached`);
  } catch (err) {
    if (err instanceof fileStore.FileStoreError) return unprocessable(res, err.message);
    next(err);
  }
}

/* ── GET /api/installations/csat — I-5 ───────────────────────────────── */

async function csatDashboard(req, res, next) {
  try {
    const groupBy = req.query.groupBy || 'period';
    const match = { 'feedback.receivedAt': { $ne: null } };

    const groupKey = {
      technician: '$technicianName',
      job: '$jobNumber',
      period: { $dateToString: { format: '%Y-%m', date: '$feedback.receivedAt' } },
    }[groupBy];
    if (!groupKey) return badRequest(res, 'groupBy must be technician, job or period');

    const rows = await InstallationJob.aggregate([
      { $match: match },
      {
        $group: {
          _id: groupKey,
          jobs: { $sum: 1 },
          meanCsat: { $avg: '$feedback.csat' },
          firstTimeRight: { $avg: { $cond: ['$firstTimeRight', 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return ok(res, {
      groupBy,
      /* KPI_TARGETS is keyed by PROCESS first — `KPI_TARGETS.csat` was
         undefined, so this dashboard reported no target at all. */
      target: pipeline.KPI_TARGETS.installation.csat.target,
      rows: rows.map((r) => ({
        key: r._id ?? '(unassigned)',
        jobs: r.jobs,
        meanCsat: Math.round(r.meanCsat * 100) / 100,
        firstTimeRightRate: Math.round(r.firstTimeRight * 1000) / 10,
      })),
    });
  } catch (err) { next(err); }
}

module.exports = {
  listJobs, getJob, planJob, updateChecklist, addSnag, closeSnag,
  recordCommissioning, previewJobGate, advanceJob, recordHandover,
  checkIn, addIssue, resolveIssue, recordFeedback, recordCorrectiveAction,
  closeJob, uploadAttachment, csatDashboard,
  uploadMiddleware: upload.single('file'),
};
