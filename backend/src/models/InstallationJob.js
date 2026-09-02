'use strict';
/**
 * InstallationJob — Process 3 (Installation & Customer Service).
 *
 * Created ONLY by processHandoffService.createInstallationJobForWorkOrder(), itself
 * reachable only through the DA-gated `deliver` endpoint. As with Handoff 1,
 * reachability IS the enforcement: an Installation Job existing is evidence
 * that a signed Delivery Acknowledgement and photo are on file upstream. (H-2)
 *
 * ── The closure gate is the spine of this process ────────────────────────
 * "A job record cannot be marked Closed in ERP until the Customer Feedback
 * Form is received." Everything else here exists to make that gate meaningful:
 * checklists that must complete before a stage advances, a commissioning
 * report signed by BOTH technician and customer, and — when CSAT lands below
 * 3.0 — a documented corrective action plan before closure is even possible.
 */
const mongoose = require('mongoose');
const pipeline = require('../config/pipeline');
const StageHistorySchema = require('./schemas/stageHistory');
const AttachmentSchema   = require('./schemas/attachment');

/** Carried from the Work Order, which carried it from the Lead (A24). */
const CustomerSnapshotSchema = new mongoose.Schema({
  name:    { type: String, required: true, trim: true },
  company: { type: String, trim: true, default: '' },
  phone:   { type: String, trim: true, default: '' },
  email:   { type: String, trim: true, default: '' },
  city:    { type: String, trim: true, default: '' },
  state:   { type: String, trim: true, default: '' },
  zone:    { type: String, trim: true, default: '' },
}, { _id: false });

/**
 * One stage checklist. `stageKey` is what pipeline.findChecklist() matches on,
 * so the `checklistDone:<stage>` and `checklistSigned:<stage>` gate tests read
 * these directly — the templates in pipeline.js are the single source and this
 * is only their instantiated state.
 */
const ChecklistItemSchema = new mongoose.Schema({
  key:      { type: String, required: true },
  label:    { type: String, required: true },
  required: { type: Boolean, default: true },
  done:     { type: Boolean, default: false },
  doneAt:   { type: Date, default: null },
  doneBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: false });

const ChecklistSchema = new mongoose.Schema({
  stageKey:     { type: String, required: true },
  items:        { type: [ChecklistItemSchema], default: [] },
  /* The technician's signature on the Installation Checklist (I2 exit). */
  signedByName: { type: String, trim: true, default: '' },
  signedAt:     { type: Date, default: null },
}, { _id: false });

/**
 * A snagging item. `major` and `blocker` block commissioning — that is the
 * framework's "no open snagging items remain", and it is also what makes
 * First-Time-Right measurable rather than self-reported.
 */
const SnagSchema = new mongoose.Schema({
  severity:    { type: String, enum: pipeline.SNAG_SEVERITIES, required: true },
  description: { type: String, required: true, trim: true },
  reportedAt:  { type: Date, default: Date.now },
  reportedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  closedAt:    { type: Date, default: null },
  resolution:  { type: String, trim: true, default: '' },
}, { _id: true });

/** A post-handover support issue, with its response SLA (I-11). */
const IssueSchema = new mongoose.Schema({
  description: { type: String, required: true, trim: true },
  severity:    { type: String, enum: pipeline.SNAG_SEVERITIES, default: 'minor' },
  slaHours:    { type: Number, default: pipeline.ISSUE_SLA_HOURS },
  reportedAt:  { type: Date, default: Date.now },
  reportedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt:  { type: Date, default: null },
  resolution:  { type: String, trim: true, default: '' },
  slaBreached: { type: Boolean, default: false },
}, { _id: true });

const InstallationJobSchema = new mongoose.Schema({
  jobNumber: { type: String, required: true, unique: true },

  /* Upstream chain. Back-references for traceability; installation ROUTES
     never populate the Lead (A24). */
  workOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkOrder', required: true, unique: true },
  lead:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },

  /* The account this job is for.
     `customerSnapshot` above is the denormalised copy taken at handoff (A24) and stays —
     delivery and installation staff read it without touching a Lead. This is the link to
     the Customer ENTITY, which the AMC created at sign-off hangs off and which lets an
     installation appear in Customer 360. Nullable: jobs created before Phase 4 have none,
     and supportService resolves it through the lead when it is missing. */
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  customerSnapshot: { type: CustomerSnapshotSchema, required: true },

  stage:  { type: String, enum: pipeline.INSTALL_STAGE_KEYS, default: 'planning' },
  status: { type: String, enum: pipeline.INSTALL_STATUSES, default: 'open', index: true },

  /* I1 — planning */
  siteReady: {
    confirmedAt: { type: Date, default: null },
    confirmedBy: { type: String, trim: true, default: '' },  // customer contact
    notes:       { type: String, trim: true, default: '' },
  },
  technician:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  technicianName: { type: String, trim: true, default: '' },  // denormalised for CSAT-by-technician
  scheduledDate:  { type: Date, default: null },

  checklists: { type: [ChecklistSchema], default: [] },
  snags:      { type: [SnagSchema], default: [] },

  /* ── On-site customer sign-off (doc 4, IC-FE-04 → IC-HD-04) ────────────────
     DISTINCT from `feedback.csat` below, which is the form dispatched 14 days after
     handover (I-3/I-5). This is what the customer taps on the engineer's tablet as they
     hand over — a different question at a different moment, and doc 4 shows the Install
     Head reading THIS one when approving the sign-off. Collapsing the two would make the
     14-day collection-rate KPI meaningless, since every job would already have a score. */
  signOff: {
    signatoryName:  { type: String, trim: true, default: '' },
    signatoryTitle: { type: String, trim: true, default: '' },
    /* The attachment storageKey of the captured signature image. */
    signatureRef:   { type: String, trim: true, default: '' },
    signedAt:       { type: Date, default: null },
    csat:           { type: Number, min: 0, max: pipeline.CSAT_MAX, default: null },
    completionReport: { type: String, trim: true, default: '' },
    collectedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /* The Head's decision. Approving is what creates the Contract. */
    approval:       { type: mongoose.Schema.Types.ObjectId, ref: 'Approval', default: null },
    approvedAt:     { type: Date, default: null },
    approvedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    contract:       { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', default: null },
  },

  /* I3 — commissioning. The DUAL signature is explicit in the framework:
     "signed by the technician and countersigned by the customer
     representative." One signature does not satisfy the gate. */
  commissioning: {
    passed:                  { type: Boolean, default: false },
    technicianSignedAt:      { type: Date, default: null },
    customerCountersignedAt: { type: Date, default: null },
    customerSignatory:       { type: String, trim: true, default: '' },
    retestCount:             { type: Number, default: 0 },
    notes:                   { type: String, trim: true, default: '' },
  },

  /* I4 — handover */
  handover: {
    trainedAttendees: { type: [String], default: [] },
    handedOverAt:     { type: Date, default: null },
  },

  /* I5 — the support window */
  postSupport: {
    checkInDueAt:  { type: Date, default: null },
    checkInDoneAt: { type: Date, default: null },
    issues:        { type: [IssueSchema], default: [] },
  },

  /* I6 — feedback and closure */
  feedback: {
    dispatchedAt:   { type: Date, default: null },
    reminderSentAt: { type: Date, default: null },
    receivedAt:     { type: Date, default: null },
    csat:           { type: Number, min: 0, max: pipeline.CSAT_MAX, default: null },
    comments:       { type: String, trim: true, default: '' },
  },
  correctiveAction: {
    required:     { type: Boolean, default: false },
    dueAt:        { type: Date, default: null },
    documentedAt: { type: Date, default: null },
    plan:         { type: String, trim: true, default: '' },
  },

  /* Derived at I2 close: no retest AND no blocking snag. Records whether a
     return visit was needed — the First-Time-Right KPI. */
  firstTimeRight: { type: Boolean, default: null },

  attachments:    { type: [AttachmentSchema], default: [] },
  stageHistory:   { type: [StageHistorySchema], default: [] },
  stageEnteredAt: { type: Date, default: Date.now },
  completedAt:    { type: Date, default: null },   // I2 complete — install lead time (A13)
  closedAt:       { type: Date, default: null },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

InstallationJobSchema.index({ stage: 1, status: 1 });
InstallationJobSchema.index({ technician: 1 });
InstallationJobSchema.index({ customer: 1 });
InstallationJobSchema.index({ 'feedback.receivedAt': 1 });
InstallationJobSchema.index({ 'correctiveAction.dueAt': 1 });
InstallationJobSchema.index({ createdAt: -1 });

InstallationJobSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('InstallationJob', InstallationJobSchema);
