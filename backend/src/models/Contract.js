'use strict';
const mongoose = require('mongoose');
const pipeline = require('../config/pipeline');

/**
 * Contract — an AMC or warranty. ERP Bible V3 document 4.
 *
 * Created by the Install Head approving a customer sign-off (IC-HD-04: "On close, the AMC
 * record is automatically created and the CS Manager is notified"), and the thing the
 * renewal loop runs on: IC-CSM-04 pushes an expiring contract back into Sales as a
 * Suspect, which is where the specification's cycle closes.
 *
 * `value` and `renewalValue` are redacted from CS Agents by config/fieldVisibility.js —
 * doc 4 IC-AG-03 is explicit that an agent sees the AMC but not what it is worth.
 */
const ContractSchema = new mongoose.Schema({
  ref:      { type: String, required: true, unique: true, trim: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  installationJob: { type: mongoose.Schema.Types.ObjectId, ref: 'InstallationJob', default: null },
  /* The deal this came from, so a renewal can be assigned to the executive who closed it
     rather than to whoever happens to own the account today. */
  originDeal: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },

  type:      { type: String, enum: pipeline.CONTRACT_TYPES, default: 'amc' },
  product:   { type: String, trim: true, default: '' },
  startsAt:  { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  value:        { type: Number, min: 0, default: 0 },
  renewalValue: { type: Number, min: 0, default: 0 },

  status: { type: String, enum: ['active', 'expiring', 'expired', 'renewed', 'cancelled'], default: 'active' },

  /* The renewal loop back into Sales. `renewalLead` is the back-pointer that makes
     "push to Sales" idempotent — the same guard both process handoffs use. */
  renewalPushedAt: { type: Date, default: null },
  renewalPushedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  renewalLead:     { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },

  notes:     { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

ContractSchema.index({ customer: 1, expiresAt: 1 });
ContractSchema.index({ expiresAt: 1, status: 1 });
ContractSchema.index({ installationJob: 1 });

/** Days until expiry — negative once expired. */
ContractSchema.virtual('daysToExpiry').get(function daysToExpiry() {
  if (!this.expiresAt) return null;
  return Math.ceil((this.expiresAt.getTime() - Date.now()) / 86400000);
});

ContractSchema.set('toJSON', { virtuals: true });
ContractSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Contract', ContractSchema);
