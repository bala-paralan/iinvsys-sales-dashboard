'use strict';
/**
 * WorkOrder — Process 2 (Delivery).
 *
 * Created ONLY by processHandoffService.createWorkOrderForLead(), which is itself only
 * reachable through the PO-gated `→ commercial_order` transition. That chain is
 * what makes Handoff 1 a workflow gate rather than a convention: there is no
 * route that creates a Work Order out of thin air, so a Work Order existing
 * IS evidence that a verified PO exists upstream. (H-1)
 *
 * ── customerSnapshot, not a Lead reference (A24) ─────────────────────────
 * Delivery staff legitimately need the customer's name, phone and address.
 * They are NOT granted `lead.read`, and this document never populates from
 * Lead. The snapshot is denormalised at handoff time, which is also
 * historically correct — the delivery record should reflect the customer as
 * they stood at PO verification, not as someone edits them six weeks later.
 *
 * ── originalCommittedDate is write-once (A12) ────────────────────────────
 * Every SLA in the framework ("no later than 48 hours before the ORIGINALLY
 * committed date") measures against the first date ever committed. If revising
 * a date could move the reference point, repeated small revisions would reset
 * the clock indefinitely and the Delay Notification Compliance KPI would be
 * meaningless. `currentCommittedDate` moves; the original never does.
 */
const mongoose = require('mongoose');
const pipeline = require('../config/pipeline');
const StageHistorySchema = require('./schemas/stageHistory');
const AttachmentSchema   = require('./schemas/attachment');

const CustomerSnapshotSchema = new mongoose.Schema({
  name:    { type: String, required: true, trim: true },
  company: { type: String, trim: true, default: '' },
  phone:   { type: String, trim: true, default: '' },
  email:   { type: String, trim: true, default: '' },
  city:    { type: String, trim: true, default: '' },
  state:   { type: String, trim: true, default: '' },
  zone:    { type: String, trim: true, default: '' },
}, { _id: false });

const ItemSchema = new mongoose.Schema({
  product:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  name:     { type: String, required: true, trim: true },
  sku:      { type: String, trim: true, default: '' },
  quantity: { type: Number, min: 1, default: 1 },
  unitPrice:{ type: Number, min: 0, default: 0 },
}, { _id: true });

/**
 * One delay event. The framework requires every delay to carry a reason code
 * for monthly performance review (D-4), and `noticeHours` — measured against
 * the ORIGINAL committed date — is the number the compliance KPI reads.
 */
const DelayEventSchema = new mongoose.Schema({
  reasonCode:  { type: String, enum: pipeline.DELAY_REASON_KEYS, required: true },
  note:        { type: String, trim: true, default: '' },
  previousDate:{ type: Date, required: true },
  revisedDate: { type: Date, required: true },
  noticeHours: { type: Number, required: true },
  /* noticeHours < 48 — recorded, never rejected. Refusing to record a late
     delay would simply hide the breach the KPI exists to count. (D-9) */
  lateNotice:  { type: Boolean, default: false },
  by:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  at:          { type: Date, default: Date.now },
}, { _id: true });

/* ── Production, ERP Bible V3 document 3 ─────────────────────────────────────
   These extend the EXISTING Work Order rather than arriving as a parallel
   `ProductionOrder`. The order_review → … → delivery_handover chain already models this
   flow and processHandoffService already mints it; a second model would duplicate
   Handoff 1 and its idempotency, and then the two would disagree. */

/* PD-HD-04 / PD-ENG-03. Quantities and part names are visible to the engineer;
   `unitCost` is stripped from their payload by utils/redact.js. */
const BomLineSchema = new mongoose.Schema({
  part:     { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 0 },
  unit:     { type: String, trim: true, default: 'nos' },
  spec:     { type: String, trim: true, default: '' },
  unitPrice:{ type: Number, min: 0, default: 0 },
  procured: { type: Boolean, default: false },
  note:     { type: String, trim: true, default: '' },
}, { _id: true });

/* PD-ENG-02: the step-by-step WIP checklist the Head defines and the engineer works
   through, with a photo as proof at each stage. */
const WipStepSchema = new mongoose.Schema({
  order:       { type: Number, required: true, min: 1 },
  label:       { type: String, required: true, trim: true },
  instruction: { type: String, trim: true, default: '' },
  status:      { type: String, enum: ['pending', 'in_progress', 'done', 'blocked'], default: 'pending' },
  completedAt: { type: Date, default: null },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  /* The attachment id of the proof photo, held in GridFS like every other upload. */
  photo:       { type: String, trim: true, default: '' },
  note:        { type: String, trim: true, default: '' },
}, { _id: true });

/* PD-HD-07: one row per test parameter, exactly as doc 3 draws the QC table.
   `marginal` exists because doc 3's worked example turns on it — a temperature 1°C over
   spec but inside the customer's own tolerance band. Forcing that to pass/fail would
   make the engineer choose between lying and failing a good unit. */
const QcTestSchema = new mongoose.Schema({
  parameter: { type: String, required: true, trim: true },
  standard:  { type: String, trim: true, default: '' },
  result:    { type: String, trim: true, default: '' },
  status:    { type: String, enum: ['pass', 'fail', 'marginal'], required: true },
}, { _id: true });

/* PD-ENG-05: an engineer cannot fix a late part or a wrong drawing themselves. */
const ProductionIssueSchema = new mongoose.Schema({
  description: { type: String, required: true, trim: true },
  severity:    { type: String, enum: ['low', 'medium', 'high', 'blocker'], default: 'medium' },
  raisedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  raisedAt:    { type: Date, default: Date.now },
  resolvedAt:  { type: Date, default: null },
  resolution:  { type: String, trim: true, default: '' },
}, { _id: true });

const WorkOrderSchema = new mongoose.Schema({
  woNumber: { type: String, required: true, unique: true },

  /* The upstream sale. A back-reference for traceability — delivery ROUTES
     never populate it (A24). */
  lead:     { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, unique: true },
  poNumber: { type: String, trim: true, default: '' },
  poValue:  { type: Number, min: 0, default: 0 },

  customerSnapshot: { type: CustomerSnapshotSchema, required: true },
  items:            { type: [ItemSchema], default: [] },

  stage:  { type: String, enum: pipeline.DELIVERY_STAGE_KEYS, default: 'order_review' },
  status: { type: String, enum: pipeline.WORKORDER_STATUSES, default: 'created', index: true },

  /* D1 clocks (A11): acceptance within 1 business day of creation, and date
     confirmation within 1 business day of ACCEPTANCE, tracked separately. */
  acceptedAt: { type: Date, default: null },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  originalCommittedDate: { type: Date, default: null },
  currentCommittedDate:  { type: Date, default: null },
  committedDateSetAt:    { type: Date, default: null },
  customerAck: {
    acknowledged: { type: Boolean, default: false },
    at:           { type: Date, default: null },
    method:       { type: String, trim: true, default: '' },
  },

  delayEvents: { type: [DelayEventSchema], default: [] },

  /* ── Production (doc 3) ──────────────────────────────────────────────────── */
  /* PD-HD-02. One engineer per order; doc 3 mentions splitting an order across
     engineers, which is a Phase 3+ refinement and not modelled here. */
  assignedEngineer:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedAt:         { type: Date, default: null },
  bom:                { type: [BomLineSchema], default: [] },
  wipSteps:           { type: [WipStepSchema], default: [] },
  productionIssues:   { type: [ProductionIssueSchema], default: [] },

  /* PD-HD-07 — the mandatory gate. `approvedAt` is what unlocks dispatch, and only the
     Production Head can set it: an engineer holds no `workorder.dispatch`, AND the
     dispatch stage gate requires this field. Two independent layers, because doc 3 calls
     this out twice as something that must not be bypassable. */
  qc: {
    tests:          { type: [QcTestSchema], default: [] },
    notes:          { type: String, trim: true, default: '' },
    submittedAt:    { type: Date, default: null },
    submittedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt:     { type: Date, default: null },
    approvedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedAt:     { type: Date, default: null },
    rejectedReason: { type: String, trim: true, default: '' },
  },

  /* PD-HD-08 — the Head authorises the physical dispatch and records how it went. */
  dispatchAuth: {
    mode:             { type: String, trim: true, default: '' },
    awb:              { type: String, trim: true, default: '' },
    dispatchDate:     { type: Date, default: null },
    expectedDelivery: { type: Date, default: null },
    cartons:          { type: Number, min: 0, default: null },
    grossWeightKg:    { type: Number, min: 0, default: null },
    notes:            { type: String, trim: true, default: '' },
    authorisedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    authorisedAt:     { type: Date, default: null },
  },

  stockConfirmedAt: { type: Date, default: null },
  packingCheckedBy: { type: String, trim: true, default: '' },
  dispatchedAt:     { type: Date, default: null },
  dispatchDetails: {
    carrier:   { type: String, trim: true, default: '' },
    reference: { type: String, trim: true, default: '' },
  },

  deliveredAt: { type: Date, default: null },
  deliveryAccuracy: {
    itemsDelivered: { type: Number, default: null },
    discrepancies:  { type: [String], default: [] },
  },
  damageReported: { type: Boolean, default: false },

  /* PO Accuracy KPI: incremented whenever items or poValue change after
     acceptance — a revision means the PO did not match the agreed terms. */
  revisionCount: { type: Number, default: 0 },

  /* Handoff 2 back-pointer, set when the DA gate fires (B3). */
  installationJob: { type: mongoose.Schema.Types.ObjectId, ref: 'InstallationJob', default: null },

  attachments:  { type: [AttachmentSchema], default: [] },
  stageHistory: { type: [StageHistorySchema], default: [] },
  stageEnteredAt: { type: Date, default: Date.now },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

WorkOrderSchema.index({ stage: 1, status: 1 });
WorkOrderSchema.index({ createdAt: -1 });
WorkOrderSchema.index({ currentCommittedDate: 1 });
WorkOrderSchema.index({ acceptedAt: 1 });
/* PD-ENG-01: "my assigned orders" is the engineer's whole world, and the hottest query
   in the production module. */
WorkOrderSchema.index({ assignedEngineer: 1, stage: 1 });
WorkOrderSchema.index({ 'qc.submittedAt': 1, 'qc.approvedAt': 1 });

/* Write-once enforcement for the delay-clock reference point (A12).
   The persisted value is read back rather than inferred from document state —
   one extra query, but only on the rare path where someone modifies the field
   on an existing document, and it THROWS rather than silently ignoring. A
   silent ignore would let a caller believe they moved the reference date. */
WorkOrderSchema.pre('save', async function () {
  if (this.isNew || !this.isModified('originalCommittedDate')) return;
  const prior = await this.constructor.findById(this._id)
    .select('originalCommittedDate').lean();
  if (prior && prior.originalCommittedDate != null) {
    throw new Error(
      'originalCommittedDate is write-once — date revisions go through POST /:id/delay '
      + 'so the 48-hour notice clock cannot be reset (A12)');
  }
});

WorkOrderSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

/** Percentage of WIP steps completed — PD-HD-01's "% Complete" column. */
WorkOrderSchema.virtual('wipPercent').get(function wipPercent() {
  if (!this.wipSteps || !this.wipSteps.length) return null;
  const done = this.wipSteps.filter((s) => s.status === 'done').length;
  return Math.round((done / this.wipSteps.length) * 100);
});

WorkOrderSchema.set('toJSON', { virtuals: true });
WorkOrderSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('WorkOrder', WorkOrderSchema);
