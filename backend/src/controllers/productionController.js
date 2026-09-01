'use strict';
const WorkOrder = require('../models/WorkOrder');
const User = require('../models/User');
const pipeline = require('../config/pipeline');
const { ok, created, notFound, badRequest, forbidden, paginated } = require('../utils/response');
const { parsePaging } = require('../utils/pagination');
const { scopeFilter, scopeAllows } = require('../services/scopeService');
const { can } = require('../middleware/rbac');
const activityService = require('../services/activityService');
const notify = require('../services/notificationService');
const audit = require('../services/auditService');
const fileStore = require('../utils/fileStore');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: fileStore.MAX_BYTES } });

/*
 * Production & Delivery — ERP Bible V3 document 3.
 *
 * The delivery STAGES, the SLA clocks, the DA gate and Handoff 2 are unchanged from v2
 * and stay in workOrderController. What lives here is what doc 3 adds: engineer
 * assignment, the WIP checklist, the QC gate, and dispatch authorisation.
 *
 * Doc 3's defining constraint is stated twice and is not a UI matter:
 *   "Financial data is visible only to the Production Head and Sales Director. This is a
 *    backend access control — not just hidden in the UI but not sent to the engineer's
 *    session at all."
 * That is enforced by utils/redact.js at the response chokepoint, by the projection in
 * `visibleFields()` below, and asserted by tests/31-financial-redaction.test.js.
 */

/**
 * Which columns leave Mongo for this caller.
 *
 * The third redaction layer, and the only one that stops the value crossing the process
 * boundary at all. `redact()` strips it from the response; this stops it being read.
 * Defence in depth for the rule doc 3 is most emphatic about — and a real saving on the
 * list endpoints, which is why it is here rather than everywhere.
 */
/**
 * The completed-step percentage, computed here rather than read as a virtual.
 *
 * `WorkOrderSchema.virtual('wipPercent')` exists, but `.lean()` does NOT evaluate
 * virtuals — `lean({ virtuals: true })` needs the mongoose-lean-virtuals plugin, which is
 * not installed, so the option is silently ignored and the field is simply absent. Every
 * read path here is lean for the projection, so the number is derived explicitly.
 */
function withWipPercent(row) {
  const steps = row.wipSteps || [];
  return {
    ...row,
    wipPercent: steps.length
      ? Math.round((steps.filter((s) => s.status === 'done').length / steps.length) * 100)
      : null,
  };
}

function visibleFields(user) {
  const base = 'woNumber lead poNumber customerSnapshot stage status assignedEngineer assignedAt '
    + 'currentCommittedDate originalCommittedDate acceptedAt dispatchedAt deliveredAt '
    + 'wipSteps qc dispatchAuth productionIssues attachments stageEnteredAt createdAt';
  return can(user, 'finance.read') ? `${base} poValue items bom` : `${base} items.name items.sku items.quantity bom.part bom.quantity bom.unit bom.spec bom.procured`;
}

/* ── GET /api/production/orders ─ PD-HD-01 / PD-ENG-01 ───────────────────── */

async function listOrders(req, res, next) {
  try {
    const filter = {};
    /* An engineer's scope is 'own', which for a Work Order means the order assigned to
       them — there is no owner column, so the resolver is pointed at assignedEngineer. */
    Object.assign(filter, scopeFilter(req.scope, 'assignedEngineer'));
    if (req.query.stage) filter.stage = req.query.stage;
    if (req.query.engineer && scopeAllows(req.scope, req.query.engineer)) {
      filter.assignedEngineer = req.query.engineer;
    }
    if (req.query.unassigned === 'true') filter.assignedEngineer = null;

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 100 });
    const [rows, total] = await Promise.all([
      WorkOrder.find(filter)
        .select(visibleFields(req.user))
        .populate('assignedEngineer', 'name initials color')
        .sort({ currentCommittedDate: 1, createdAt: -1 })
        .skip(skip).limit(limit).lean(),
      WorkOrder.countDocuments(filter),
    ]);
    return paginated(res, rows.map(withWipPercent), total, page, limit);
  } catch (err) { next(err); }
}

/* ── GET /api/production/orders/:id ─ PD-HD-03 / PD-ENG-02 ───────────────── */

async function getOrder(req, res, next) {
  try {
    const wo = await WorkOrder.findById(req.params.id)
      .select(visibleFields(req.user))
      .populate('assignedEngineer', 'name initials color')
      .lean();
    if (!wo) return notFound(res, 'Production order not found');
    /* 404 rather than 403 for an order that is not theirs, so ids cannot be probed. */
    if (!scopeAllows(req.scope, wo.assignedEngineer)) return notFound(res, 'Production order not found');
    return ok(res, withWipPercent(wo));
  } catch (err) { next(err); }
}

/* ── GET /api/production/workload ─ PD-HD-02 ─────────────────────────────── */

async function workload(req, res, next) {
  try {
    const engineers = await User.find({ role: 'production_engineer', isActive: true })
      .select('name initials color').lean();

    const rows = await WorkOrder.aggregate([
      { $match: { assignedEngineer: { $ne: null }, stage: { $ne: 'delivery_handover' } } },
      { $group: { _id: '$assignedEngineer', orders: { $sum: 1 } } },
    ]);
    const counts = new Map(rows.map((r) => [String(r._id), r.orders]));

    const overdue = await WorkOrder.find({
      currentCommittedDate: { $lt: new Date() },
      deliveredAt: null,
    }).select('woNumber assignedEngineer currentCommittedDate customerSnapshot.company').lean();

    const [unassigned, qcPending, readyToDispatch] = await Promise.all([
      WorkOrder.countDocuments({ assignedEngineer: null, deliveredAt: null }),
      WorkOrder.countDocuments({ 'qc.submittedAt': { $ne: null }, 'qc.approvedAt': null }),
      WorkOrder.countDocuments({ 'qc.approvedAt': { $ne: null }, dispatchedAt: null }),
    ]);

    return ok(res, {
      engineers: engineers.map((e) => ({
        user: e,
        orders: counts.get(String(e._id)) || 0,
        overdue: overdue.filter((o) => String(o.assignedEngineer) === String(e._id)).length,
      })),
      unassigned,
      qcPending,
      readyToDispatch,
      overdue,
    });
  } catch (err) { next(err); }
}

/* ── POST /api/production/orders/:id/assign ─ PD-HD-02 ───────────────────── */

async function assignEngineer(req, res, next) {
  try {
    const { engineer, wipSteps } = req.body;
    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return notFound(res, 'Production order not found');

    if (engineer) {
      const eng = await User.findById(engineer).select('name role').lean();
      if (!eng || eng.role !== 'production_engineer') {
        return badRequest(res, 'Orders are assigned to a Production Engineer');
      }
      wo.assignedEngineer = engineer;
      wo.assignedAt = new Date();
      await notify.notifyUser(engineer, {
        event: 'lead.assigned',
        severity: 'warn',
        title: `Production order ${wo.woNumber} assigned to you`,
        body: `${wo.customerSnapshot?.company || ''} — due ${
          wo.currentCommittedDate ? new Date(wo.currentCommittedDate).toLocaleDateString('en-IN') : 'TBC'}`,
        reason: 'It was assigned to you.',
        entityType: 'workorder',
        entityId: wo._id,
      });
    } else {
      wo.assignedEngineer = null;
      wo.assignedAt = null;
    }

    /* The Head defines the WIP steps when assigning — doc 3 PD-ENG-02 shows the engineer
       following a checklist "defined by the Production Head", not writing their own. */
    if (Array.isArray(wipSteps) && wipSteps.length) {
      wo.wipSteps = wipSteps.map((s, i) => ({
        order: s.order ?? i + 1,
        label: s.label,
        instruction: s.instruction || '',
        status: 'pending',
      }));
    }

    await wo.save();
    await audit.record({
      action: 'record.update',
      entityType: 'workorder',
      entityId: wo._id,
      summary: `${wo.woNumber} assigned`,
      meta: { engineer: engineer ? String(engineer) : null, steps: wo.wipSteps.length },
    }, req);

    return ok(res, wo, engineer ? 'Engineer assigned' : 'Engineer unassigned');
  } catch (err) { next(err); }
}

/* ── PUT /api/production/orders/:id/bom ─ PD-HD-04 ───────────────────────── */

async function setBom(req, res, next) {
  try {
    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return notFound(res, 'Production order not found');
    if (!Array.isArray(req.body.bom)) return badRequest(res, 'bom must be an array');

    wo.bom = req.body.bom.map((l) => ({
      part: l.part, quantity: l.quantity, unit: l.unit || 'nos',
      spec: l.spec || '', unitPrice: l.unitPrice || 0,
      procured: !!l.procured, note: l.note || '',
    }));
    await wo.save();
    return ok(res, wo.bom, 'Bill of materials saved');
  } catch (err) { next(err); }
}

/* ── PATCH /api/production/orders/:id/steps/:stepId ─ PD-ENG-02 ──────────── */

async function updateStep(req, res, next) {
  try {
    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return notFound(res, 'Production order not found');
    if (!scopeAllows(req.scope, wo.assignedEngineer)) {
      return forbidden(res, 'That order is not assigned to you');
    }

    const step = wo.wipSteps.id(req.params.stepId);
    if (!step) return notFound(res, 'Step not found');

    if (req.body.status) {
      step.status = req.body.status;
      step.completedAt = req.body.status === 'done' ? new Date() : null;
      step.completedBy = req.body.status === 'done' ? req.user._id : null;
    }
    if (req.body.note !== undefined) step.note = req.body.note;
    await wo.save();

    return ok(res, { step, wipPercent: wo.wipPercent }, 'Step updated');
  } catch (err) { next(err); }
}

/* ── POST /api/production/orders/:id/steps/:stepId/photo ─ PD-ENG-02 ─────── */

async function uploadStepPhoto(req, res, next) {
  try {
    if (!req.file) return badRequest(res, 'A photo file is required');
    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return notFound(res, 'Production order not found');
    if (!scopeAllows(req.scope, wo.assignedEngineer)) {
      return forbidden(res, 'That order is not assigned to you');
    }
    const step = wo.wipSteps.id(req.params.stepId);
    if (!step) return notFound(res, 'Step not found');

    /* Same path every other upload takes: magic-byte validated, virus-scan hook, GridFS
       by default. A WIP photo is evidence, so it belongs in the vault with the rest. */
    const stored = await fileStore.put(req.file.buffer, {
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      docType: 'wip_photo',
      uploadedBy: req.user._id,
    });

    step.photo = stored.storageKey;
    wo.attachments.push({
      ...stored,
      docType: 'wip_photo',
      uploadedBy: req.user._id,
      note: `WIP step ${step.order}: ${step.label}`,
    });
    await wo.save();
    return created(res, { step }, 'Photo attached');
  } catch (err) {
    if (err instanceof fileStore.FileStoreError) return badRequest(res, err.message);
    next(err);
  }
}

/* ── POST /api/production/orders/:id/qc ─ PD-ENG-04 ──────────────────────── */

/** The engineer SUBMITS results. Only the Head can approve them. */
async function submitQc(req, res, next) {
  try {
    const { tests, notes = '' } = req.body;
    if (!Array.isArray(tests) || !tests.length) {
      return badRequest(res, 'At least one test result is required');
    }

    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return notFound(res, 'Production order not found');
    if (!scopeAllows(req.scope, wo.assignedEngineer)) {
      return forbidden(res, 'That order is not assigned to you');
    }
    if (wo.qc.approvedAt) return badRequest(res, 'QC has already been approved for this order');

    wo.qc.tests = tests.map((t) => ({
      parameter: t.parameter, standard: t.standard || '',
      result: t.result || '', status: t.status,
    }));
    wo.qc.notes = notes;
    wo.qc.submittedAt = new Date();
    wo.qc.submittedBy = req.user._id;
    /* Resubmission after a rejection clears the rejection, so the Head's queue shows one
       open item rather than a row that is both rejected and pending. */
    wo.qc.rejectedAt = null;
    wo.qc.rejectedReason = '';
    await wo.save();

    await notify.notifyByPermission('workorder.dispatch', {
      event: 'lead.needs_review',
      severity: 'warn',
      title: `QC submitted for ${wo.woNumber}`,
      body: `${wo.customerSnapshot?.company || ''} — ${tests.length} test result(s) awaiting your approval.`,
      reason: 'You approve QC before dispatch.',
      entityType: 'workorder',
      entityId: wo._id,
    }, { excludeUserId: req.user._id });

    return ok(res, wo.qc, 'QC results submitted for the Production Head');
  } catch (err) { next(err); }
}

/* ── POST /api/production/orders/:id/qc/decide ─ PD-HD-07 ────────────────── */

/**
 * The mandatory gate. Approving stamps `qc.approvedAt`, which is what the dispatch stage
 * gate reads — so an approval here is the only way an order can ever reach dispatch.
 */
async function decideQc(req, res, next) {
  try {
    const { status, reason = '' } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return badRequest(res, 'status must be approved or rejected');
    }

    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return notFound(res, 'Production order not found');
    if (!wo.qc.submittedAt) return badRequest(res, 'No QC results have been submitted for this order');

    if (status === 'approved') {
      wo.qc.approvedAt = new Date();
      wo.qc.approvedBy = req.user._id;
      wo.qc.rejectedAt = null;
      wo.qc.rejectedReason = '';
    } else {
      if (!reason.trim()) return badRequest(res, 'Say why QC was rejected — the engineer has to act on it');
      wo.qc.approvedAt = null;
      wo.qc.approvedBy = null;
      wo.qc.rejectedAt = new Date();
      wo.qc.rejectedReason = reason;
      /* Send it back for rework: the results no longer stand. */
      wo.qc.submittedAt = null;
    }
    await wo.save();

    if (wo.assignedEngineer) {
      await notify.notifyUser(wo.assignedEngineer, {
        event: status === 'approved' ? 'lead.stage_advanced' : 'lead.needs_review',
        severity: status === 'approved' ? 'info' : 'critical',
        title: `QC ${status} — ${wo.woNumber}`,
        body: status === 'approved' ? 'Dispatch is now unlocked.' : reason,
        reason: 'You submitted these QC results.',
        entityType: 'workorder',
        entityId: wo._id,
      });
    }

    await audit.record({
      action: 'record.update',
      entityType: 'workorder',
      entityId: wo._id,
      summary: `${wo.woNumber}: QC ${status}`,
      meta: { status, reason, tests: wo.qc.tests.length },
    }, req);

    return ok(res, wo.qc, status === 'approved'
      ? 'QC approved — dispatch unlocked'
      : 'QC rejected — returned to the engineer');
  } catch (err) { next(err); }
}

/* ── POST /api/production/orders/:id/dispatch-auth ─ PD-HD-08 ────────────── */

async function authoriseDispatch(req, res, next) {
  try {
    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return notFound(res, 'Production order not found');

    /* Belt and braces with the stage gate: this endpoint is reachable only by a holder of
       `workorder.dispatch`, and it refuses without a Head's QC approval regardless. */
    if (!wo.qc.approvedAt) {
      return badRequest(res, 'QC must be approved before dispatch can be authorised');
    }
    const { mode, awb } = req.body;
    if (!mode) return badRequest(res, 'Dispatch mode is required');
    if (!awb) return badRequest(res, 'AWB / docket number is required');

    wo.dispatchAuth = {
      mode,
      awb,
      dispatchDate: req.body.dispatchDate || new Date(),
      expectedDelivery: req.body.expectedDelivery || null,
      cartons: req.body.cartons ?? null,
      grossWeightKg: req.body.grossWeightKg ?? null,
      notes: req.body.notes || '',
      authorisedBy: req.user._id,
      authorisedAt: new Date(),
    };
    /* Keep the v2 fields in step — the delivery KPIs and the D5 gate read these. */
    wo.dispatchedAt = wo.dispatchAuth.dispatchDate;
    wo.dispatchDetails = { carrier: mode, reference: awb };
    wo.status = 'dispatched';
    await wo.save();

    await audit.record({
      action: 'record.update',
      entityType: 'workorder',
      entityId: wo._id,
      summary: `${wo.woNumber}: dispatch authorised (${mode} ${awb})`,
      meta: { mode, awb, cartons: wo.dispatchAuth.cartons },
    }, req);

    return ok(res, wo.dispatchAuth, 'Dispatch authorised');
  } catch (err) { next(err); }
}

/* ── POST /api/production/orders/:id/issues ─ PD-ENG-05 ──────────────────── */

async function flagIssue(req, res, next) {
  try {
    const { description, severity = 'medium' } = req.body;
    if (!description) return badRequest(res, 'Describe the issue');

    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return notFound(res, 'Production order not found');
    if (!scopeAllows(req.scope, wo.assignedEngineer)) {
      return forbidden(res, 'That order is not assigned to you');
    }

    wo.productionIssues.push({ description, severity, raisedBy: req.user._id });
    await wo.save();

    await notify.notifyByPermission('workorder.dispatch', {
      event: 'lead.needs_review',
      severity: severity === 'blocker' ? 'critical' : 'warn',
      title: `Issue flagged on ${wo.woNumber}`,
      body: description,
      reason: 'You run production.',
      entityType: 'workorder',
      entityId: wo._id,
    }, { excludeUserId: req.user._id });

    return created(res, wo.productionIssues[wo.productionIssues.length - 1], 'Issue flagged');
  } catch (err) { next(err); }
}

module.exports = {
  listOrders, getOrder, workload, assignEngineer, setBom,
  updateStep, uploadStepPhoto, submitQc, decideQc, authoriseDispatch, flagIssue,
  visibleFields, uploadMiddleware: upload.single('file'),
};
