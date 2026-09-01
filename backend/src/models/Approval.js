'use strict';
const mongoose = require('mongoose');

/*
 * The five things ERP Bible V3 asks someone to approve. They are the same shape — a
 * subject, a requester, a decider, a decision and a note — so they are one model with
 * five queues rather than three bespoke queues built independently in phases 2, 3 and 4.
 *
 *   is_handoff  doc 1 IS-HD-04 — IS Head approves a qualified lead into Sales
 *   discount    doc 2 SA-MGR-08 / SA-DIR-01 — 3–10% Manager, >10% Director
 *   qc          doc 3 PD-HD-07 — Production Head approves QC, unlocking dispatch
 *   co_confirm  doc 2 SA-DIR-09 — Director confirms the Commercial Order
 *   signoff     doc 4 IC-HD-04 — Install Head approves customer sign-off
 */
const APPROVAL_KINDS = ['is_handoff', 'discount', 'qc', 'co_confirm', 'signoff'];
const APPROVAL_STATUSES = ['pending', 'approved', 'returned', 'escalated', 'rejected'];

const ApprovalSchema = new mongoose.Schema({
  kind: { type: String, enum: APPROVAL_KINDS, required: true },

  subject: {
    model: { type: String, enum: ['Lead', 'WorkOrder', 'InstallationJob'], required: true },
    id:    { type: mongoose.Schema.Types.ObjectId, required: true },
  },

  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  /*
   * TARGETED, not broadcast. notificationService's `notifyByPermission` addresses every
   * active holder of a permission, so a single 7% discount request would have alerted all
   * four Sales Managers and the whole director tier. An approval belongs to one person —
   * usually the requester's `reportsTo` — and that is who gets told.
   */
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  /* Discount band for `kind:'discount'`: 1 = 0–3% self, 2 = 3–10% manager, 3 = >10%. */
  tier:    { type: Number, min: 1, max: 3, default: null },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },

  status:   { type: String, enum: APPROVAL_STATUSES, default: 'pending' },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedAt: { type: Date, default: null },
  /* Free text for a counter-offer: SA-MGR-08's "Counter: Approve 5%". */
  decision:  { type: String, trim: true, default: '' },
  note:      { type: String, trim: true, default: '' },
  escalatedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  /* Doc 2 names a COO as co-approver above 10%. No such role has a screen anywhere in
     the specification, so it is not a role — the field is reserved so that adding the
     second signature later is a write, not a migration. */
  coApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

ApprovalSchema.index({ assignedTo: 1, status: 1, createdAt: -1 });
ApprovalSchema.index({ 'subject.model': 1, 'subject.id': 1 });
ApprovalSchema.index({ kind: 1, status: 1 });
ApprovalSchema.index({ requestedBy: 1, status: 1 });

ApprovalSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('Approval', ApprovalSchema);
module.exports.APPROVAL_KINDS    = APPROVAL_KINDS;
module.exports.APPROVAL_STATUSES = APPROVAL_STATUSES;
