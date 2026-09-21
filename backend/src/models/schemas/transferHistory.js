'use strict';

const mongoose = require('mongoose');

/**
 * One ownership event on a lead — SPENCO CRM brief §7, "Lead History Log — Mandatory".
 *
 * `stageHistory` already records every stage change with who and when. This is its
 * twin for OWNERSHIP: who created the lead, who it was assigned to, and every transfer
 * — from whom, to whom, by whom, when. Before it existed an assignment left a row in the
 * AuditLog and nothing on the lead, so a lead's page could not answer "how did this get
 * to me?".
 *
 * Names are denormalised for the same reason AuditLog's are: the log has to stay
 * readable after the account it names is gone.
 */
const TransferHistorySchema = new mongoose.Schema({
  kind:     { type: String, enum: ['created', 'assigned', 'transferred'], required: true },
  from:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  fromName: { type: String, default: '' },
  to:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  toName:   { type: String, default: '' },
  by:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  byName:   { type: String, default: '' },
  at:       { type: Date, default: Date.now },
  note:     { type: String, trim: true, default: '' },
}, { _id: true });

module.exports = TransferHistorySchema;
