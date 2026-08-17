'use strict';
/**
 * WorkOrder — Process 2 (Delivery).
 *
 * Created ONLY by handoffService.createWorkOrderForLead(), which is itself only
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

module.exports = mongoose.model('WorkOrder', WorkOrderSchema);
