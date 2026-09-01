'use strict';
/*
 * NAMED `processHandoffService`, not `handoffService`.
 *
 * "Handoff" already meant two things here — Sales→Delivery and Delivery→Installation —
 * and ERP Bible V3 doc 1 IS-HD-04 introduces a third: the IS Head's "Sales Handoff
 * Approval Queue", where a qualified Inside Sales lead is approved into SPENCO. That one
 * is a `qualificationHandoff` and lands in Phase 1. Renaming this file first is cheaper
 * than three things called handoff.
 */

/**
 * processHandoffService — the two formal handoff points between the three processes.
 *
 *   Handoff 1: verified PO (→ commercial_order) ─→ Delivery Work Order
 *   Handoff 2: signed DA (status → delivered)   ─→ Installation Job   (B3)
 *
 * The framework: "these must be enforced as mandatory workflow gates in the
 * ERP — no subsequent process should be activatable without the defined
 * trigger document being present." This module is only CALLED from inside the
 * gated transitions, and nothing else creates these records, so reachability
 * is the enforcement. (H-1, H-2)
 *
 * ── Idempotent under retry (H-3) ─────────────────────────────────────────
 * Two independent mechanisms, because either alone has a gap:
 *   1. The `lead.workOrder` back-pointer — checked first, cheap, catches the
 *      common double-submit.
 *   2. The unique index on `WorkOrder.lead` — catches the race two concurrent
 *      requests can still win against check #1. The duplicate-key error is
 *      then resolved by re-reading the winner, so BOTH callers get the same
 *      Work Order back and neither sees an error.
 *
 * ── A handoff failure must not fail the sale it records ──────────────────
 * By the time this runs, the customer's PO is verified and the deal is
 * legitimately won. Refusing the transition because a downstream record could
 * not be created would hold the truth hostage to plumbing. The caller treats
 * a null return as "created nothing" and the failure is logged loudly; the
 * nightly sweep can re-fire it (`ensureWorkOrderExists`).
 */
const WorkOrder = require('../models/WorkOrder');
const pipeline = require('../config/pipeline');
const audit = require('./auditService');
const { notifyByPermission } = require('./notificationService');

/** WO-2026-00042 — human-readable, unique by index not by format. */
function nextWoNumber() {
  const year = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 1e6).toString().padStart(6, '0');
  return `WO-${year}-${rand}`;
}

/** The customer as they stand at PO verification — see A24 in the model. */
function snapshotFrom(lead) {
  return {
    name: lead.name,
    company: lead.company || '',
    phone: lead.phone || '',
    email: lead.email || '',
    city: lead.city || '',
    state: lead.state || '',
    zone: lead.zone || '',
  };
}

function itemsFrom(lead) {
  /* products may be populated docs or raw ObjectIds; carry what is known. */
  return (lead.products || []).map((p) => (
    p && p.name
      ? { product: p._id, name: p.name, sku: p.sku || '', quantity: 1, unitPrice: p.price || 0 }
      : { product: p, name: 'Product', quantity: 1 }
  ));
}

/**
 * Handoff 1. Called after the `→ commercial_order` transition has SAVED.
 *
 * @param {object} lead  the saved Lead document
 * @param {object} [req] Express request, for audit attribution
 * @returns {Promise<object|null>} the Work Order, or null on failure
 */
async function createWorkOrderForLead(lead, req) {
  try {
    /* Idempotency #1 — the back-pointer. */
    if (lead.workOrder) {
      return await WorkOrder.findById(lead.workOrder);
    }

    const payload = () => ({
      woNumber: nextWoNumber(),
      lead: lead._id,
      poNumber: lead.poNumber || '',
      poValue: lead.value || 0,
      customerSnapshot: snapshotFrom(lead),
      items: itemsFrom(lead),
      createdBy: req && req.user ? req.user._id : null,
      stageHistory: [{
        from: null,
        to: 'order_review',
        direction: 'forward',
        by: req && req.user ? req.user._id : null,
        byName: req && req.user ? req.user.name : '',
        note: `Handoff 1 — created from verified PO ${lead.poNumber || '(unnumbered)'}`,
      }],
    });

    let wo;
    for (let attempt = 0; attempt < 3 && !wo; attempt += 1) {
      try {
        wo = await WorkOrder.create(payload());
      } catch (err) {
        if (!err || err.code !== 11000) throw err;
        /* Two distinct duplicate-key cases, told apart by which index tripped:
           · lead      → idempotency #2. A concurrent request won the race;
                         return the winner so both callers get the same WO.
           · woNumber  → the random suffix collided. Loop and mint another. */
        if (err.keyPattern && err.keyPattern.lead) {
          const winner = await WorkOrder.findOne({ lead: lead._id });
          if (winner) return winner;
          throw err;
        }
        if (!(err.keyPattern && err.keyPattern.woNumber)) throw err;
      }
    }
    if (!wo) throw new Error('could not allocate a unique woNumber in 3 attempts');

    lead.workOrder = wo._id;
    await lead.save();

    await audit.record({
      action: 'handoff.created',
      entityType: 'workorder',
      entityId: wo._id,
      summary: `Work Order ${wo.woNumber} created from "${lead.name}" (Handoff 1)`,
      meta: { leadId: String(lead._id), poNumber: wo.poNumber, poValue: wo.poValue },
    }, req);

    /* "Work Order auto-created; Delivery Manager notified; target delivery
       date to be set within 1 business day." Addressed by permission — see
       notificationService. */
    await notifyByPermission('workorder.accept', {
      event: 'handoff.workorder_created',
      severity: 'critical',
      title: `New Work Order ${wo.woNumber} awaiting acceptance`,
      body: `${wo.customerSnapshot.company || wo.customerSnapshot.name} — `
          + `PO ${wo.poNumber || '(unnumbered)'}. Target delivery date must be `
          + 'confirmed within 1 business day of acceptance.',
      entityType: 'workorder',
      entityId: wo._id,
      meta: { woNumber: wo.woNumber },
    });

    return wo;
  } catch (err) {
    console.error(`HANDOFF 1 FAILED for lead ${lead._id}: ${err.message}`);
    return null;
  }
}

/**
 * Repair pass: Work Orders for any won lead that has none. This is what makes
 * "a handoff failure must not fail the sale" safe — the gap it leaves is
 * closed on the next sweep rather than persisting silently forever.
 */
async function ensureWorkOrderExists() {
  const Lead = require('../models/Lead');
  const orphans = await Lead.find({ stage: 'commercial_order', workOrder: null });
  let repaired = 0;
  for (const lead of orphans) {
    if (await createWorkOrderForLead(lead, null)) repaired += 1;
  }
  return { orphaned: orphans.length, repaired };
}

/** IJ-2026-000123 — human-readable, unique by index not by format. */
function nextJobNumber() {
  const year = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 1e6).toString().padStart(6, '0');
  return `IJ-${year}-${rand}`;
}

/**
 * Instantiate every stage checklist from the templates in pipeline.js.
 *
 * Materialised at creation rather than resolved on read, deliberately: a job
 * that ran under one version of a checklist must keep showing the items its
 * technician actually ticked. Resolving live would silently rewrite history
 * the day someone edits a template.
 */
function checklistsFromTemplates() {
  return pipeline.INSTALL_STAGES
    .filter((s) => Array.isArray(s.checklistTemplate) && s.checklistTemplate.length)
    .map((s) => ({
      stageKey: s.key,
      items: s.checklistTemplate.map((t) => ({
        key: t.key, label: t.label, required: t.required !== false, done: false,
      })),
    }));
}

/**
 * Handoff 2 — signed DA → Installation Job. (H-2)
 *
 * Same shape as Handoff 1: idempotent through a back-pointer plus a unique
 * index, and NON-FATAL. By the time this runs the goods are physically at the
 * customer's site and the DA is signed — refusing to record that because a
 * downstream record could not be created would be worse than the gap, which
 * `ensureInstallationJobExists` closes on the next sweep.
 *
 * @returns {Promise<object|null>} the Installation Job, or null on failure
 */
async function createInstallationJobForWorkOrder(workOrder, req) {
  const InstallationJob = require('../models/InstallationJob');
  try {
    if (workOrder.installationJob) {
      return await InstallationJob.findById(workOrder.installationJob);
    }

    const payload = () => ({
      jobNumber: nextJobNumber(),
      workOrder: workOrder._id,
      lead: workOrder.lead,
      customerSnapshot: workOrder.customerSnapshot,
      checklists: checklistsFromTemplates(),
      createdBy: req && req.user ? req.user._id : null,
      stageHistory: [{
        from: null,
        to: 'planning',
        direction: 'forward',
        by: req && req.user ? req.user._id : null,
        byName: req && req.user ? req.user.name : '',
        note: `Handoff 2 — created from signed DA on ${workOrder.woNumber}`,
      }],
    });

    let job;
    for (let attempt = 0; attempt < 3 && !job; attempt += 1) {
      try {
        job = await InstallationJob.create(payload());
      } catch (err) {
        if (!err || err.code !== 11000) throw err;
        /* workOrder → a concurrent deliver won the race; return the winner.
           jobNumber → the random suffix collided; loop and mint another. */
        if (err.keyPattern && err.keyPattern.workOrder) {
          const winner = await InstallationJob.findOne({ workOrder: workOrder._id });
          if (winner) return winner;
          throw err;
        }
        if (!(err.keyPattern && err.keyPattern.jobNumber)) throw err;
      }
    }
    if (!job) throw new Error('could not allocate a unique jobNumber in 3 attempts');

    workOrder.installationJob = job._id;
    await workOrder.save();

    await audit.record({
      action: 'handoff.created',
      entityType: 'installation',
      entityId: job._id,
      summary: `Installation Job ${job.jobNumber} created from ${workOrder.woNumber} (Handoff 2)`,
      meta: { workOrderId: String(workOrder._id), woNumber: workOrder.woNumber },
    }, req);

    /* "Installation Work Order auto-triggered; Installation Manager notified." */
    await notifyByPermission('install.assign', {
      event: 'handoff.installation_created',
      severity: 'critical',
      title: `New Installation Job ${job.jobNumber} — needs planning`,
      body: `${job.customerSnapshot.company || job.customerSnapshot.name} — confirm site `
          + 'readiness and assign a technician. Target: on site within 5 business days.',
      entityType: 'installation',
      entityId: job._id,
      meta: { jobNumber: job.jobNumber, woNumber: workOrder.woNumber },
    });

    return job;
  } catch (err) {
    console.error(`HANDOFF 2 FAILED for work order ${workOrder._id}: ${err.message}`);
    return null;
  }
}

/** Repair pass for Handoff 2 — the mirror of ensureWorkOrderExists. */
async function ensureInstallationJobExists() {
  const WorkOrderModel = require('../models/WorkOrder');
  const orphans = await WorkOrderModel.find({ status: 'delivered', installationJob: null });
  let repaired = 0;
  for (const wo of orphans) {
    if (await createInstallationJobForWorkOrder(wo, null)) repaired += 1;
  }
  return { orphaned: orphans.length, repaired };
}

module.exports = {
  createWorkOrderForLead, ensureWorkOrderExists, snapshotFrom,
  createInstallationJobForWorkOrder, ensureInstallationJobExists,
  checklistsFromTemplates,
};
