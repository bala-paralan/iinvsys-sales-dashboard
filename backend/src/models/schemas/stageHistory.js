'use strict';

const mongoose = require('mongoose');

/**
 * One recorded stage transition. Embedded by Lead, WorkOrder and InstallationJob.
 *
 * This is the primitive that makes the Sales conversion KPIs computable at all.
 * Before it existed, the CURRENT stage was the only signal — so a lead that
 * passed through Engagement and was later lost was indistinguishable from one
 * that never got there, and "Prospect-to-Proposal Rate" could not be measured.
 *
 * It is also the audit trail for gate overrides: `gateOverride` plus
 * `missingAtOverride` records exactly what a manager waived and when.
 */
const StageHistorySchema = new mongoose.Schema({
  from:      { type: String, default: null },
  to:        { type: String, required: true },
  at:        { type: Date, default: Date.now },
  by:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  byName:    { type: String, default: '' },
  direction: { type: String, enum: ['forward', 'backward', 'reopen', 'same', 'migration'], default: 'forward' },
  note:      { type: String, trim: true, default: '' },
  /** Days spent in the PREVIOUS stage — denormalised so cycle-time reporting is a projection, not a fold. */
  durationDays:      { type: Number, default: null },
  gateOverride:      { type: Boolean, default: false },
  missingAtOverride: [{ type: String }],
}, { _id: true });

module.exports = StageHistorySchema;
