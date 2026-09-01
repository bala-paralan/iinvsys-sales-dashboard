'use strict';
const mongoose = require('mongoose');

const ACTIVITY_TYPES = ['call', 'email', 'visit', 'whatsapp', 'meeting', 'note', 'remote_session'];
const CALL_OUTCOMES = [
  '', 'connected_positive', 'connected_objections', 'connected_not_interested',
  'not_reachable', 'voicemail', 'no_show',
];
const BANT_UPDATES = ['none', 'budget', 'authority', 'need', 'timeline'];

/**
 * Activity — one logged interaction, held against the CUSTOMER.
 *
 * This is the single most-repeated rule in the specification. Doc 2 SA-EX-04 note 1:
 * an executive with three deals at DMRC Delhi sees one DMRC timeline, because the
 * Director and Manager need the relationship, not deal-by-deal fragments.
 *
 * It replaces `Lead.followUps[]`, which was per-lead, referenced the retired `Agent`
 * model, and carried no duration, meeting or note type. Both were not kept: two activity
 * logs is how they diverge.
 */
const ActivitySchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  /* Optional: doc 2 SA-EX-04 offers "General Account Activity (no deal)" explicitly. */
  deal:     { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  ticket:   { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null },

  type:      { type: String, enum: ACTIVITY_TYPES, required: true },
  direction: { type: String, enum: ['outbound', 'inbound'], default: 'outbound' },
  occurredAt:      { type: Date, default: Date.now },
  durationMinutes: { type: Number, min: 0, default: null },
  outcome:   { type: String, enum: CALL_OUTCOMES, default: '' },
  /* Doc 2: "Notes are visible to your Sales Manager and Sales Director — write
     professionally." Required, because an activity with no summary is a tick-box. */
  summary:   { type: String, required: true, trim: true },

  contact: {
    name:        { type: String, trim: true, default: '' },
    designation: { type: String, trim: true, default: '' },
  },

  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  /* Doc 1 IS-EX-04: the call form can confirm one BANT dimension as it is logged. */
  bantUpdate: { type: String, enum: BANT_UPDATES, default: 'none' },
  /* Recorded for the timeline; the stage itself only ever moves through the advance
     endpoint, so this is a note of what happened, not a way to bypass a gate. */
  stageUpdate: { type: String, trim: true, default: '' },

  nextAction: {
    label: { type: String, trim: true, default: '' },
    dueAt: { type: Date, default: null },
  },
  createdTask: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
}, { timestamps: true });

/* The Customer 360 timeline is the hottest query in the application. */
ActivitySchema.index({ customer: 1, occurredAt: -1 });
/* Exec drill-down, and the last-activity aging that turns IS-DIR-01's cell orange at
   24h and red at 48h. */
ActivitySchema.index({ by: 1, occurredAt: -1 });
ActivitySchema.index({ deal: 1, occurredAt: -1 });
/* The daily activity counter — doc 2's "minimum 5 activities per working day". */
ActivitySchema.index({ by: 1, createdAt: -1 });
/* SA-DIR-06's Calls (8) / Emails (10) / Visits (4) tabs. */
ActivitySchema.index({ customer: 1, type: 1 });
ActivitySchema.index({ ticket: 1 });

ActivitySchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('Activity', ActivitySchema);
module.exports.ACTIVITY_TYPES = ACTIVITY_TYPES;
module.exports.CALL_OUTCOMES  = CALL_OUTCOMES;
module.exports.BANT_UPDATES   = BANT_UPDATES;
