'use strict';
/**
 * Work Orders — Process 2 (Delivery). B2b.
 *
 * Every route sits behind requirePermission() — delivery staff reach these
 * without holding any sales permission, and never read a Lead (A24: the
 * customer travels as a snapshot frozen at handoff).
 *
 * Stage moves go through the same stageService as leads, over
 * DELIVERY_STAGES — one transition contract, three processes.
 */
const multer = require('multer');
const WorkOrder = require('../models/WorkOrder');
const pipeline = require('../config/pipeline');
const { applyTransition, previewGate } = require('../services/stageService');
const fileStore = require('../utils/fileStore');
const audit = require('../services/auditService');
const { notifyByPermission } = require('../services/notificationService');
const { hoursBetween } = require('../utils/businessDays');
const { ok, created, notFound, badRequest, unprocessable, gateFailed, paginated } = require('../utils/response');
const { parsePaging } = require('../utils/pagination');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: fileStore.MAX_BYTES },
});

/**
 * Doc 04 grants `agent` a SCOPED workorder.read — the delivery outcome of
 * their own deals, never the whole queue. Scoping is by the upstream lead's
 * assignment; delivery roles fall through with no filter.
 */
async function agentScopeFilter(req) {
  if (req.user.role !== 'agent') return null;
  const Lead = require('../models/Lead');
  const mine = await Lead.find({ assignedAgent: req.user.agentId }).select('_id').lean();
  return { lead: { $in: mine.map((l) => l._id) } };
}

/* ── GET /api/workorders ─────────────────────────────────────────────── */

async function listWorkOrders(req, res, next) {
  try {
    const filter = (await agentScopeFilter(req)) || {};
    if (req.query.stage) filter.stage = req.query.stage;
    if (req.query.status) filter.status = req.query.status;

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 100 });
    const [rows, total] = await Promise.all([
      WorkOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      WorkOrder.countDocuments(filter),
    ]);
    return paginated(res, rows, total, page, limit);
  } catch (err) { next(err); }
}

/* ── GET /api/workorders/:id ─────────────────────────────────────────── */

async function getWorkOrder(req, res, next) {
  try {
    /* NEVER populates `lead` — A24. The snapshot is the customer record here. */
    const wo = await WorkOrder.findById(req.params.id).lean();
    if (!wo) return notFound(res, 'Work Order not found');

    /* Agent scoping: 404, not 403, so ids cannot be probed. */
    const scope = await agentScopeFilter(req);
    if (scope && !scope.lead.$in.some((id) => String(id) === String(wo.lead))) {
      return notFound(res, 'Work Order not found');
    }
    return ok(res, wo);
  } catch (err) { next(err); }
}

/* ── POST /api/workorders/:id/accept ─────────────────────────────────── */

async function acceptWorkOrder(req, res, next) {
  try {
    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return notFound(res, 'Work Order not found');
    if (wo.acceptedAt) return ok(res, wo, 'Already accepted'); // idempotent

    wo.acceptedAt = new Date();
    wo.acceptedBy = req.user._id;
    wo.status = 'accepted';
    await wo.save();

    await audit.record({
      action: 'record.update', entityType: 'workorder', entityId: wo._id,
      summary: `Work Order ${wo.woNumber} accepted`,
      meta: { acceptedAt: wo.acceptedAt },
    }, req);

    return ok(res, wo, 'Work Order accepted — the delivery-date clock is running (1 business day)');
  } catch (err) { next(err); }
}

/* ── POST /api/workorders/:id/commit-date ────────────────────────────── */

async function commitDate(req, res, next) {
  try {
    const { date, ackMethod = '' } = req.body || {};
    const parsed = date ? new Date(date) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return badRequest(res, 'A valid target delivery date is required');
    }

    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return notFound(res, 'Work Order not found');
    if (!wo.acceptedAt) return badRequest(res, 'Accept the Work Order before committing a date');

    /* After the first commitment, every date change is a DELAY EVENT with a
       reason code — that is what keeps the 48-hour KPI honest (A12). */
    if (wo.originalCommittedDate) {
      return unprocessable(res,
        'A committed date already exists — date changes go through POST /:id/delay with a reason code');
    }

    wo.originalCommittedDate = parsed;
    wo.currentCommittedDate = parsed;
    wo.committedDateSetAt = new Date();
    wo.customerAck = { acknowledged: true, at: new Date(), method: ackMethod };
    await wo.save();

    await audit.record({
      action: 'record.update', entityType: 'workorder', entityId: wo._id,
      summary: `Delivery date committed for ${wo.woNumber}`,
      meta: { committedDate: parsed, ackMethod },
    }, req);

    return ok(res, wo, 'Target delivery date committed and acknowledged');
  } catch (err) { next(err); }
}

/* ── POST /api/workorders/:id/delay ──────────────────────────────────── */

async function logDelay(req, res, next) {
  try {
    const { reasonCode, revisedDate, note = '' } = req.body || {};
    const parsed = revisedDate ? new Date(revisedDate) : null;
    if (!pipeline.DELAY_REASON_KEYS.includes(reasonCode)) {
      return unprocessable(res, 'A delay reason code is required (D-4)');
    }
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return badRequest(res, 'A valid revised date is required');
    }

    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return notFound(res, 'Work Order not found');
    if (!wo.originalCommittedDate) {
      return badRequest(res, 'No committed date exists yet — use commit-date first');
    }

    /* A12: notice is measured against the ORIGINAL committed date unless the
       (configurable, default-off) rule says the clock follows revisions. */
    const rules = pipeline.getActiveRules();
    const reference = rules.delayClockResetsOnRevision
      ? wo.currentCommittedDate
      : wo.originalCommittedDate;
    const noticeHours = Math.round(hoursBetween(new Date(), reference));
    const lateNotice = noticeHours < pipeline.DELAY_NOTICE_MIN_HOURS;

    wo.delayEvents.push({
      reasonCode, note,
      previousDate: wo.currentCommittedDate,
      revisedDate: parsed,
      noticeHours, lateNotice,
      by: req.user._id,
    });
    wo.currentCommittedDate = parsed;
    await wo.save();

    /* D-9: a late notice is recorded, never rejected — refusing it would hide
       the breach — but it escalates loudly. */
    await notifyByPermission(['workorder.accept', 'lead.gate_override'], {
      event: lateNotice ? 'delivery.delay_late_notice' : 'delivery.delay_logged',
      severity: lateNotice ? 'critical' : 'warn',
      title: lateNotice
        ? `LATE delay notice on ${wo.woNumber} — ${noticeHours}h before the original date`
        : `Delivery date revised on ${wo.woNumber}`,
      body: `${wo.customerSnapshot.company || wo.customerSnapshot.name}: `
          + `${reasonCode.replace(/_/g, ' ')} — now ${parsed.toDateString()}.`,
      entityType: 'workorder', entityId: wo._id,
      meta: { reasonCode, noticeHours, lateNotice },
    }, { excludeUserId: req.user._id });

    await audit.record({
      action: 'record.update', entityType: 'workorder', entityId: wo._id,
      summary: `Delay logged on ${wo.woNumber} (${reasonCode}, notice ${noticeHours}h${lateNotice ? ' — LATE' : ''})`,
      meta: { reasonCode, noticeHours, lateNotice, revisedDate: parsed },
    }, req);

    return ok(res, wo, lateNotice
      ? `Delay recorded — NOTICE BREACH: only ${noticeHours}h before the originally committed date`
      : 'Delay recorded');
  } catch (err) { next(err); }
}

/* ── POST /api/workorders/:id/dispatch ───────────────────────────────── */

async function dispatchWorkOrder(req, res, next) {
  try {
    const { carrier = '', reference = '' } = req.body || {};
    if (!carrier.trim()) return badRequest(res, 'Record the carrier or vehicle');

    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return notFound(res, 'Work Order not found');

    wo.dispatchedAt = new Date();
    wo.dispatchDetails = { carrier: carrier.trim(), reference: reference.trim() };
    wo.status = 'dispatched';
    await wo.save();

    return ok(res, wo, 'Shipment dispatched');
  } catch (err) { next(err); }
}

/* ── stage transitions — same contract as leads ──────────────────────── */

async function previewWorkOrderGate(req, res, next) {
  try {
    const wo = await WorkOrder.findById(req.params.id).lean();
    if (!wo) return notFound(res, 'Work Order not found');

    const toStage = req.query.to || pipeline.nextStage(pipeline.DELIVERY_STAGES, wo.stage);
    if (!toStage) {
      return ok(res, {
        from: wo.stage, to: null, allowed: false,
        message: 'This is the final delivery stage — closure happens through POST /:id/deliver',
        requirements: [],
      });
    }
    return ok(res, { from: wo.stage, to: toStage, ...previewGate(wo, pipeline.DELIVERY_STAGES, toStage) });
  } catch (err) { next(err); }
}

async function advanceWorkOrder(req, res, next) {
  try {
    const { toStage, note = '', patch } = req.body || {};
    if (!toStage) return badRequest(res, 'toStage is required');

    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return notFound(res, 'Work Order not found');

    /* No force/override path here: the permission matrix defines no
       workorder gate override, and the delivery documents are contractual. */
    const result = applyTransition(wo, pipeline.DELIVERY_STAGES, {
      toStage, patch, note, actor: req.user,
    });
    if (!result.ok) return gateFailed(res, result.code, result.message, result.missing);

    if (toStage !== 'order_review' && wo.status === 'accepted') wo.status = 'in_progress';
    await wo.save();

    await audit.stageTransition({
      entityType: 'workorder', entityId: wo._id,
      from: result.from, to: result.to, direction: result.direction,
      note, label: wo.woNumber,
    }, req);

    return ok(res, {
      workOrder: wo,
      transition: { from: result.from, to: result.to, direction: result.direction },
    }, `Moved to ${pipeline.stageLabel(pipeline.DELIVERY_STAGES, result.to)}`);
  } catch (err) { next(err); }
}

/* ── POST /api/workorders/:id/deliver — the DA gate ──────────────────── */

async function deliverWorkOrder(req, res, next) {
  try {
    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return notFound(res, 'Work Order not found');
    if (wo.status === 'delivered') return ok(res, wo, 'Already delivered'); // idempotent

    if (req.body && req.body.itemsDelivered !== undefined) {
      wo.deliveryAccuracy.itemsDelivered = Number(req.body.itemsDelivered);
    }
    if (req.body && Array.isArray(req.body.discrepancies)) {
      wo.deliveryAccuracy.discrepancies = req.body.discrepancies;
    }

    /* D-6: signed DA WITH photo, mandatory. The framework calls the DA "a
       mandatory contractual record — no Work Order can be closed without it". */
    const verdict = pipeline.validateRequirements(wo, pipeline.DELIVERED_REQUIRES, new Date());
    if (!verdict.ok) {
      return gateFailed(res, 'DA_GATE_FAILED',
        `Cannot mark delivered — ${verdict.missing.length} requirement(s) not met`,
        verdict.missing);
    }

    wo.deliveredAt = new Date();
    wo.status = 'delivered';
    await wo.save();

    await audit.stageTransition({
      entityType: 'workorder', entityId: wo._id,
      from: wo.stage, to: 'delivered', direction: 'forward',
      note: 'DA gate passed', label: wo.woNumber,
    }, req);

    /* Handoff 2 — Installation Job. The service seam exists; B3 fills it in.
       Same rule as Handoff 1: a handoff failure must not un-deliver a
       physically delivered order. */
    const { createInstallationJobForWorkOrder } = require('../services/handoffService');
    const job = await createInstallationJobForWorkOrder(wo, req);

    return ok(res, {
      workOrder: wo,
      ...(job && { installationJob: { _id: job._id, jobNumber: job.jobNumber } }),
    }, 'Delivered — Delivery Acknowledgement on file');
  } catch (err) { next(err); }
}

/* ── POST /api/workorders/:id/upload ─────────────────────────────────── */

async function uploadAttachment(req, res, next) {
  try {
    const { docType } = req.body || {};
    if (!pipeline.DOC_TYPE_KEYS.includes(docType)) {
      return unprocessable(res, `docType must be one of: ${pipeline.DOC_TYPE_KEYS.join(', ')}`);
    }
    if (!req.file) return badRequest(res, 'Attach a file under the field name "file"');

    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return notFound(res, 'Work Order not found');

    const stored = await fileStore.put(req.file.buffer, {
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      docType,
      uploadedBy: req.user._id,
    });

    wo.attachments.push({ ...stored, docType, uploadedBy: req.user._id });
    await wo.save();

    return created(res, wo.attachments.at(-1), `${docType} attached`);
  } catch (err) {
    if (err instanceof fileStore.FileStoreError) {
      return unprocessable(res, err.message);
    }
    next(err);
  }
}

module.exports = {
  listWorkOrders, getWorkOrder, acceptWorkOrder, commitDate, logDelay,
  dispatchWorkOrder, previewWorkOrderGate, advanceWorkOrder, deliverWorkOrder,
  uploadAttachment, uploadMiddleware: upload.single('file'),
};
