'use strict';
const mongoose = require('mongoose');
const pipeline = require('../config/pipeline');
const SpencoSchema       = require('./schemas/spenco');
const StageHistorySchema = require('./schemas/stageHistory');
const AttachmentSchema   = require('./schemas/attachment');

const {
  COMPANY_TYPE_KEYS, INDUSTRY_SEGMENT_KEYS, ZONE_KEYS,
  COMPETITOR_KEYS, LOST_TO_KEYS, SUBSCRIPTION_KEYS, AMC_KEYS,
} = pipeline;

/* Every new picklist is optional at the SCHEMA layer and mandatory at the GATE
   layer. That split is the enforcement model from 01-crm-data-dictionary.md:
   capture at an expo must stay fast, so a blank field never blocks a save — it
   flags the record for review and blocks the next STAGE instead. */
const opt = (keys) => ['', ...keys];

const FollowUpSchema = new mongoose.Schema({
  agent:          { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
  channel:        { type: String, enum: ['call','whatsapp','email','visit','other'], required: true },
  note:           { type: String, trim: true, default: '' },
  outcome:        { type: String, trim: true, default: '' },
  nextActionDate: { type: Date },
  timestamp:      { type: Date, default: Date.now },
}, { _id: true });

/* PRD 1 — per-field OCR provenance.
   Each field captured by scan stores its band (high/med/low), the original
   OCR value, and whether the rep edited it before save. */
const OcrFieldSchema = new mongoose.Schema({
  band:          { type: String, enum: ['high','med','low'], required: true },
  originalValue: { type: String, default: '' },
  rawConfidence: { type: Number, min: 0, max: 1 },
  corrected:     { type: Boolean, default: false },
}, { _id: false });

const OcrCaptureSchema = new mongoose.Schema({
  scannedAt:    { type: Date, default: Date.now },
  ocrEngine:    { type: String, default: 'tesseract.js@5' },
  fields:       { type: Map, of: OcrFieldSchema, default: {} },
}, { _id: false });

/* PRD 4 — when the rep created a new lead despite a duplicate match,
   record what they overrode and why. */
const DupeOverrideSchema = new mongoose.Schema({
  matchedLeadId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  reason:          { type: String, enum: ['different-person','different-role','other'], required: true },
  reasonDetail:    { type: String, trim: true, default: '' },
  overriddenAt:    { type: Date, default: Date.now },
}, { _id: false });

/* PRD 3 — bulk scan batch metadata */
const BatchSchema = new mongoose.Schema({
  batchId:   { type: String, required: true },
  batchName: { type: String, trim: true, default: '' },
}, { _id: false });

/* PRD 5 — per-field auto-enrichment provenance.
   Stored as a Map keyed by field name (logo, website, industry, etc.). */
const EnrichmentFieldSchema = new mongoose.Schema({
  value:       { type: mongoose.Schema.Types.Mixed },
  provider:    { type: String },
  enrichedAt:  { type: Date, default: Date.now },
}, { _id: false });

/* Filter taxonomy — mirrored in routes/leads.js, app.js LEAD_TAXONOMY,
   and the <select> options in index.html. */
const NATURE_OF_BUSINESS = [
  '', 'distribution', 'reseller', 'builder', 'service-and-installation',
  'system-integrator', 'solution-provider', 'oem', 'manufacturer',
  'component-vendor', 'product-fabricator', 'marketing',
  'sales-and-service-support', 'end-consumer', 'other',
];
const INTERESTED_IN = [
  '', 'dealership', 'collaboration', 'product-integration',
  'direct-purchase', 'other',
];

const LeadSchema = new mongoose.Schema({
  name:             { type: String, required: true, trim: true },
  phone:            { type: String, required: true, trim: true },
  email:            { type: String, lowercase: true, trim: true, default: '' },
  company:          { type: String, trim: true, default: '' },
  city:             { type: String, trim: true, default: '' },
  state:            { type: String, trim: true, default: '' },
  natureOfBusiness: { type: String, enum: NATURE_OF_BUSINESS, default: '' },
  interestedIn:     { type: String, enum: INTERESTED_IN, default: '' },
  /* B1b — the CRM Data Dictionary vocabularies replace the legacy enums.
     Greenfield (R-3): a legacy value is a 422, never a silent upgrade. The
     mapping that WOULD have been applied is preserved in
     docs/requirements/archive/08-migration-notes.md if it is ever revived. */
  source:        { type: String, enum: pipeline.LEAD_SOURCE_KEYS, required: true },
  expo:          { type: mongoose.Schema.Types.ObjectId, ref: 'Expo', default: null },
  stage:         { type: String, enum: pipeline.SALES_STAGE_KEYS, default: 'suspect' },
  assignedAgent: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', default: null },
  products:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  value:         { type: Number, default: 0, min: 0 },
  score:         { type: Number, default: 50, min: 0, max: 100 },
  notes:         { type: String, trim: true, default: '' },
  lostReason:    { type: String, enum: opt(pipeline.LOST_REASON_KEYS), default: '' },
  isReEngage:    { type: Boolean, default: false },
  followUps:     [FollowUpSchema],
  lastContact:   { type: Date, default: null },
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ocrCapture:    { type: OcrCaptureSchema, default: null },
  dupeOverride:  { type: DupeOverrideSchema, default: null },
  /* PRD 3 */
  batch:         { type: BatchSchema, default: null },
  /* PRD 5 */
  enrichment:    { type: Map, of: EnrichmentFieldSchema, default: {} },
  doNotEnrich:   [{ type: String }],
  jobTitle:      { type: String, trim: true, default: '' },
  website:       { type: String, trim: true, default: '' },
  industry:      { type: String, trim: true, default: '' },
  employeeCount: { type: String, trim: true, default: '' },
  hqCountry:     { type: String, trim: true, default: '' },
  linkedinUrl:   { type: String, trim: true, default: '' },
  logoUrl:       { type: String, trim: true, default: '' },

  /* ── CRM Data Dictionary fields (B1) ──────────────────────────────────
     See docs/requirements/01-crm-data-dictionary.md. Gated, not required —
     see the note on `opt` above. */

  /* Contact / segmentation */
  companyType:     { type: String, enum: opt(COMPANY_TYPE_KEYS), default: '' },
  /* `industry` above stays free-text and enrichment-owned; this is the
     compliance-gated picklist the rep owns. Assumption A21 — deliberately two
     fields, and enrichment may suggest a segment but never writes one. */
  industrySegment: { type: String, enum: opt(INDUSTRY_SEGMENT_KEYS), default: '' },
  zone:            { type: String, enum: opt(ZONE_KEYS), default: '' },

  /* Ownership. `assignedAgent` is an Agent; `ownerUser` is the User account
     accountable for the stage, which is what the framework means by
     "stage owner" and what stageHistory.by records. */
  ownerUser:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  /* Opportunity */
  opportunityName:  { type: String, trim: true, default: '' },
  productPackage:   { type: String, trim: true, default: '' },
  probability:      { type: Number, min: 0, max: 100, default: null },
  probabilityOverrideNote: { type: String, trim: true, default: '' },
  expectedCloseDate: { type: Date, default: null },
  nextAction:        { type: String, trim: true, default: '' },
  nextFollowUpDate:  { type: Date, default: null },
  nextFollowUpNote:  { type: String, trim: true, default: '' },
  competitor:        { type: String, enum: opt(COMPETITOR_KEYS), default: '' },
  competitorOther:   { type: String, trim: true, default: '' },

  /* Commercial Order */
  poNumber:            { type: String, trim: true, default: '' },
  subscriptionOffered: { type: String, enum: opt(SUBSCRIPTION_KEYS), default: '' },
  amcOffered:          { type: String, enum: opt(AMC_KEYS), default: '' },

  /* Loss. `lostReason` above is still free text; it becomes an enum in B1b
     alongside the stage/source cutover, so both land together. */
  lostReasonDetail: { type: String, trim: true, default: '' },
  lostTo:           { type: String, enum: opt(LOST_TO_KEYS), default: '' },
  lostToName:       { type: String, trim: true, default: '' },

  /* Qualification, history, documents */
  spenco:        { type: SpencoSchema, default: null },
  stageEnteredAt:{ type: Date, default: Date.now },
  stageHistory:  { type: [StageHistorySchema], default: [] },
  attachments:   { type: [AttachmentSchema], default: [] },

  /* Handoff 1 back-pointer. Written only by handoffService; its presence is
     the idempotency check that keeps a retried commercial_order transition
     from minting a second Work Order (H-3). */
  workOrder:     { type: mongoose.Schema.Types.ObjectId, ref: 'WorkOrder', default: null },

  /* Hygiene — never blocks anything; surfaces in the manager review queue. */
  needsReview:   { type: Boolean, default: false },
  reviewIssues:  { type: [String], default: [] },
}, { timestamps: true });

/* Indexes for common query patterns */
LeadSchema.index({ assignedAgent: 1, stage: 1 });
LeadSchema.index({ source: 1 });
LeadSchema.index({ expo: 1 });
LeadSchema.index({ stage: 1 });
LeadSchema.index({ phone: 1 });
LeadSchema.index({ score: -1 });
LeadSchema.index({ createdAt: -1 });
LeadSchema.index({ lastContact: 1 });
LeadSchema.index({ city: 1 });
LeadSchema.index({ state: 1 });
LeadSchema.index({ natureOfBusiness: 1 });
LeadSchema.index({ interestedIn: 1 });
/* Text search */
LeadSchema.index({ name: 'text', phone: 'text', email: 'text' });

/* B1 query patterns: the hygiene queue, the review sweeps, and the conversion
   KPIs — every Sales rate in 05-kpi-definitions.md is a stageHistory query. */
LeadSchema.index({ needsReview: 1 });
LeadSchema.index({ ownerUser: 1, stage: 1 });
LeadSchema.index({ nextFollowUpDate: 1 });
LeadSchema.index({ expectedCloseDate: 1 });
LeadSchema.index({ stageEnteredAt: 1 });
LeadSchema.index({ zone: 1 });
LeadSchema.index({ companyType: 1 });
LeadSchema.index({ 'stageHistory.to': 1, 'stageHistory.at': 1 });

/* ── Derivations ──────────────────────────────────────────────────────────
   All four helpers already exist in config/pipeline.js and are pure, so the
   same rules run here, in the gate validator, in the nightly sweeps and in the
   payload the browser renders from. Duplicating any of this in a controller is
   how the copies drift. */

/* Everything derived lives in ONE pre('validate') hook, deliberately.
 *
 * `Lead.insertMany()` — used by CSV bulk import and bulk card scan — runs
 * validate middleware but NOT save middleware. With the derivations split
 * across both hooks, bulk-imported leads silently skipped hygiene entirely:
 * they were created with needsReview:false and never appeared in the review
 * queue, which is precisely the population most likely to need reviewing. */
LeadSchema.pre('validate', function deriveFields(next) {
  /* Zone is auto-filled from state (C-8). An unrecognised state leaves it blank
     and is flagged by hygieneIssues rather than guessed at — see A17. */
  if (this.state) {
    const zone = pipeline.deriveZone(this.state);
    if (zone) this.zone = zone;
  }

  /* Opportunity Name follows `[Company] — [Product/Package] — [Mon YYYY]` (C-9),
     composed only when the user left it blank so a hand-written name survives. */
  if (!this.opportunityName && this.company) {
    const when = this.expectedCloseDate || this.createdAt || new Date();
    const stamp = new Date(when).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    this.opportunityName = [this.company, this.productPackage, stamp]
      .filter(Boolean).join(' — ');
  }

  /* SPENCO total and qualification are DERIVED, never trusted from the client —
     otherwise a caller could post `qualified: true` and walk through the gate. */
  if (this.spenco) {
    this.spenco.total     = pipeline.spencoTotal(this.spenco);
    this.spenco.qualified = pipeline.spencoQualified(this.spenco);
    /* `scoredAt` is what the → Engagement gate reads. It is stamped the first
       time any dimension is scored and never moved afterwards, so it records
       when the assessment happened rather than when the record was last
       touched. Nothing wrote it before, which made Engagement unreachable. */
    if (!this.spenco.scoredAt && pipeline.spencoScored(this.spenco)) {
      this.spenco.scoredAt = new Date();
    }
  }

  /* A lead's stage history begins where the LEAD began.
   *
   * stageService only appends on a transition, so before this a lead created
   * at `suspect` had an empty stageHistory — and the Suspect-to-Prospect KPI
   * divides entries into `prospect` by entries into `suspect`. With no opening
   * entry the denominator counted only leads that moved BACKWARD into suspect,
   * so the rate was structurally meaningless and could exceed 100%.
   *
   * Seeded in pre('validate'), not pre('save'), because bulk import and bulk
   * card scan go through insertMany, which skips save middleware. */
  if (this.isNew && Array.isArray(this.stageHistory) && this.stageHistory.length === 0) {
    this.stageHistory.push({
      from: null,
      to: this.stage,
      at: this.createdAt || new Date(),
      direction: 'forward',
      note: 'Lead created',
    });
  }

  /* Hygiene is recomputed on every write so the review queue cannot go stale
     between nightly sweeps. It is a pure function over this document. */
  const issues = pipeline.hygieneIssues(this);
  this.reviewIssues = issues.map((i) => i.code);
  this.needsReview  = issues.length > 0;

  next();
});

/* Virtual: followUp count */
LeadSchema.virtual('followUpCount').get(function() {
  return this.followUps.length;
});

/* Virtual: overdue (no contact in >7 days and not closed) */
LeadSchema.virtual('isOverdue').get(function() {
  if (pipeline.TERMINAL_SALES_STAGES.includes(this.stage)) return false;
  if (!this.lastContact) return this.followUps.length === 0;
  const days = (Date.now() - new Date(this.lastContact)) / 86400000;
  return days > 7;
});

LeadSchema.set('toJSON', { virtuals: true });
LeadSchema.set('toObject', { virtuals: true });

LeadSchema.methods.toJSON = function() {
  const obj = this.toObject({ virtuals: true });
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('Lead', LeadSchema);
module.exports.NATURE_OF_BUSINESS = NATURE_OF_BUSINESS;
module.exports.INTERESTED_IN      = INTERESTED_IN;
