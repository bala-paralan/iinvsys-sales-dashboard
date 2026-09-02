'use strict';
const mongoose = require('mongoose');
const pipeline = require('../config/pipeline');

/**
 * Ticket — a customer support request. ERP Bible V3 document 4.
 *
 * DISTINCT FROM `InstallationJob.postSupport.issues[]`, deliberately. Those are issues
 * raised inside one job's seven-day support window and they gate that job's Feedback
 * stage (I-11). A Ticket belongs to the CUSTOMER and outlives the job entirely — doc 4's
 * worked example is a DMRC sensor going offline against a live AMC, months after the
 * install closed. Folding them together would mean either an installation job that can
 * never close because a ticket is open, or a ticket that disappears when it does.
 *
 * The SLA is stamped at creation rather than computed on read: doc 4 shows a countdown,
 * and a countdown against a target that silently moves when policy changes is worse than
 * no countdown.
 */
const TicketActivitySchema = new mongoose.Schema({
  type:     { type: String, enum: ['call', 'email', 'remote_session', 'whatsapp', 'note'], required: true },
  summary:  { type: String, required: true, trim: true },
  minutes:  { type: Number, min: 0, default: null },
  by:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  at:       { type: Date, default: Date.now },
}, { _id: true });

const TicketSchema = new mongoose.Schema({
  ref:      { type: String, required: true, unique: true, trim: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  /* Optional back-references — a ticket can predate or outlive either. */
  installationJob: { type: mongoose.Schema.Types.ObjectId, ref: 'InstallationJob', default: null },
  contract:        { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', default: null },

  product:     { type: String, trim: true, default: '' },
  issueType:   { type: String, enum: pipeline.TICKET_ISSUE_TYPES.map((t) => t.key), default: 'other' },
  subject:     { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  contact:     { name: { type: String, trim: true, default: '' }, phone: { type: String, trim: true, default: '' } },

  priority: { type: String, enum: pipeline.TICKET_PRIORITY_KEYS, default: 'medium' },
  status:   { type: String, enum: pipeline.TICKET_STATUSES, default: 'open' },

  /* Doc 4 IC-AG-01: "CS Agents see only their own assigned tickets." */
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  raisedAt:  { type: Date, default: Date.now },
  /* Stamped from the priority's band at creation, then frozen. See the note above. */
  slaHours:  { type: Number, default: null },
  slaDueAt:  { type: Date, default: null },
  /* Set when the clock runs out, and NOT unset by a later resolution — a breach that
     disappears once someone fixes the ticket is a breach nobody ever reports. */
  slaBreached:   { type: Boolean, default: false },
  firstResponseAt: { type: Date, default: null },
  resolvedAt:  { type: Date, default: null },
  resolution:  { type: String, trim: true, default: '' },
  closedAt:    { type: Date, default: null },

  activities: { type: [TicketActivitySchema], default: [] },
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

/* The agent's own queue — the hottest query in the module. */
TicketSchema.index({ assignedTo: 1, status: 1, slaDueAt: 1 });
TicketSchema.index({ customer: 1, raisedAt: -1 });
TicketSchema.index({ status: 1, slaDueAt: 1 });
TicketSchema.index({ slaBreached: 1 });
TicketSchema.index({ contract: 1 });

/* Derive the SLA once, on creation. `priority` changing later re-derives it, because an
   escalation to Critical that kept a 48-hour clock would be meaningless. */
TicketSchema.pre('validate', function deriveSla(next) {
  if (this.isNew || this.isModified('priority')) {
    this.slaHours = pipeline.ticketSlaHours(this.priority);
    const from = this.raisedAt || new Date();
    this.slaDueAt = new Date(from.getTime() + this.slaHours * 3600000);
  }
  if (this.slaDueAt && !this.resolvedAt && Date.now() > this.slaDueAt.getTime()) {
    this.slaBreached = true;
  }
  next();
});

/** Milliseconds left on the clock; negative once breached. Null when resolved. */
TicketSchema.virtual('slaRemainingMs').get(function slaRemaining() {
  if (this.resolvedAt || !this.slaDueAt) return null;
  return this.slaDueAt.getTime() - Date.now();
});

TicketSchema.set('toJSON', { virtuals: true });
TicketSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Ticket', TicketSchema);
