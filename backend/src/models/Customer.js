'use strict';
const mongoose = require('mongoose');
const pipeline = require('../config/pipeline');

const { COMPANY_TYPE_KEYS, INDUSTRY_SEGMENT_KEYS, ZONE_KEYS, DOMAIN_KEYS } = pipeline;
const opt = (keys) => ['', ...keys];

const ContactSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  designation: { type: String, trim: true, default: '' },
  email:       { type: String, lowercase: true, trim: true, default: '' },
  phone:       { type: String, trim: true, default: '' },
  isPrimary:   { type: Boolean, default: false },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { _id: true });

/**
 * Customer — the account.
 *
 * The rule ERP Bible V3 restates in both doc 1 (IS-EX-03) and doc 2 (SA-EX-04) is that
 * activities are logged against the COMPANY, not the lead: three deals at DMRC Delhi
 * share one timeline. Without this model there is nothing for that timeline to hang off,
 * and Customer 360 — which aggregates deals, IS leads, CS tickets, production orders and
 * AMC status — has no subject.
 *
 * NOTHING DERIVED IS STORED HERE. `lifetimeRevenue`, `activeDeals`, `openCsTickets`,
 * `amcStatus`, `totalInteractions` and `lastContact` are computed by
 * services/customerService.js. Storing them would buy a little read speed in exchange for
 * cache invalidation across all four modules, for numbers that are one aggregation away.
 */
const CustomerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  /* Lowercased, punctuation- and suffix-stripped, plus the city. The unique index on it
     is what makes the automated create path (handoffs, AMC renewal, CO trigger) safe to
     retry. See services/customerService.js normalizeKey(). */
  normalizedKey: { type: String, required: true, unique: true, trim: true },
  aliases:       [{ type: String, trim: true }],

  domain:          { type: String, enum: DOMAIN_KEYS, default: 'none' },
  industrySegment: { type: String, enum: opt(INDUSTRY_SEGMENT_KEYS), default: '' },
  companyType:     { type: String, enum: opt(COMPANY_TYPE_KEYS), default: '' },
  city:            { type: String, trim: true, default: '' },
  state:           { type: String, trim: true, default: '' },
  zone:            { type: String, enum: opt(ZONE_KEYS), default: '' },

  /* The exec who owns the relationship, and the manager above them. Doc 2 SA-DIR-06
     renders "Account Manager: Vikram Nair (Mgr 1)" from the second. */
  accountOwner:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  accountManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  contacts: { type: [ContactSchema], default: [] },
  status:   { type: String, enum: ['active', 'dormant', 'lost'], default: 'active' },
  /* Set when this record was folded into another by POST /customers/:id/merge. */
  mergedInto: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

CustomerSchema.index({ accountOwner: 1 });
CustomerSchema.index({ accountManager: 1 });
CustomerSchema.index({ domain: 1 });
CustomerSchema.index({ city: 1 });
CustomerSchema.index({ status: 1 });
CustomerSchema.index({ name: 'text' });

CustomerSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('Customer', CustomerSchema);
