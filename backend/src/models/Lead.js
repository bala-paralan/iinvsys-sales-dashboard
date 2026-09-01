'use strict';
const mongoose = require('mongoose');
const pipeline = require('../config/pipeline');
const SpencoSchema       = require('./schemas/spenco');
const StageHistorySchema = require('./schemas/stageHistory');
const AttachmentSchema   = require('./schemas/attachment');

/*
 * BANT — doc 1 IS-EX-05. Four independent confirmations, each with the note that makes
 * it auditable: IS-HD-04 shows the IS Head reading "Budget ₹80–120L confirmed ✓" before
 * approving a handoff, so `confirmed` alone would not be enough to decide on.
 */
const BantDimensionSchema = new mongoose.Schema({
  confirmed:   { type: Boolean, default: false },
  note:        { type: String, trim: true, default: '' },
  confirmedAt: { type: Date, default: null },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: false });

const {
  COMPANY_TYPE_KEYS, INDUSTRY_SEGMENT_KEYS, ZONE_KEYS,
  COMPETITOR_KEYS, LOST_TO_KEYS, SUBSCRIPTION_KEYS, AMC_KEYS,
} = pipeline;

/* Every new picklist is optional at the SCHEMA layer and mandatory at the GATE
   layer. That split is the enforcement model from 01-crm-data-dictionary.md:
   capture at an expo must stay fast, so a blank field never blocks a save — it
   flags the record for review and blocks the next STAGE instead. */
const opt = (keys) => ['', ...keys];

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
  /* ERP Bible V3 runs two tracks over one collection. Doc 1 numbers Inside Sales
     records IS-2026-XXXX and doc 2 numbers deals SA-2026-XXX; IS-DIR-03's "Bypass IS"
     creates BOTH. A qualified IS record never flips in place — it mints a linked
     track:'sales' document — so Customer 360 can show the whole history. A separate
     `Deal` model was rejected because Lead.stage IS the SPENCO stage that stageService,
     processHandoffService, kpiService and excelReport all read. */
  track:         { type: String, enum: ['inside_sales', 'sales'], default: 'sales' },
  /* Inside Sales records run on pipeline.IS_STAGES; `stage` above holds the SPENCO
     stage for track:'sales'. One field, two tables — which one applies is decided by
     `track`, and stageService is generic over whichever list it is handed. */
  isStage:       { type: String, enum: pipeline.IS_STAGE_KEYS, default: null },
  bant: {
    budget:    { type: BantDimensionSchema, default: () => ({}) },
    authority: { type: BantDimensionSchema, default: () => ({}) },
    need:      { type: BantDimensionSchema, default: () => ({}) },
    timeline:  { type: BantDimensionSchema, default: () => ({}) },
  },
  /* Doc 1 IS-DIR-03: the Director may hold a lead personally rather than let it
     disappear into an executive's list. */
  directorManaged:      { type: Boolean, default: false },
  priority:             { type: String, enum: ['hot', 'high', 'normal'], default: 'normal' },
  targetFirstContactAt: { type: Date, default: null },
  /* The open handoff request, and the Sales lead an approved one minted. Both are
     back-pointers written only by the service that performs the action — their presence
     is what makes a retried approval idempotent. */
  handoffApproval: { type: mongoose.Schema.Types.ObjectId, ref: 'Approval', default: null },
  convertedTo:     { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  refId:         { type: String, trim: true, default: '' },
  originLead:    { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  /* The account this record belongs to. `company` above is retained as raw provenance
     — what the rep actually typed — while `customer` is the queried column. */
  customer:      { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  /* The User accountable for this record — the "stage owner" of the framework, and
     what stageHistory.by records. v2 split this across `assignedAgent` (an Agent) and
     an unpopulated `ownerUser`; the org-chart resolver in services/scopeService.js
     returns User ids and cannot filter a column of Agent ids, so there is now one. */
  owner:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  products:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  value:         { type: Number, default: 0, min: 0 },
  score:         { type: Number, default: 50, min: 0, max: 100 },
  notes:         { type: String, trim: true, default: '' },
  lostReason:    { type: String, enum: opt(pipeline.LOST_REASON_KEYS), default: '' },
  isReEngage:    { type: Boolean, default: false },
  lastContact:   { type: Date, default: null },
  /* When an Activity was last logged against this deal. Denormalised deliberately:
     config/pipeline.js is a pure function over one lead document — it may not query a
     second collection — and the C-5 "one note per week" hygiene rule needs this anchor.
     Stamped by services/activityService.js in the same operation as the activity. */
  lastActivityAt: { type: Date, default: null },
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

  /* ── Discount authority (doc 2, SA-EX-06 → SA-MGR-08 → SA-DIR-07) ──────────
     The CURRENT state of the ask. The decision trail lives on the Approval, which is
     where a counter-offer and an escalation are recorded; this is what the deal itself
     is priced at right now. */
  discount: {
    percent:       { type: Number, min: 0, max: 100, default: 0 },
    justification: { type: String, trim: true, default: '' },
    /* List price before the discount. Captured rather than derived, because `value`
       moves as the deal is negotiated and the margin impact has to be against the price
       that was actually quoted. */
    standardPrice: { type: Number, min: 0, default: 0 },
    status:        { type: String, enum: ['none', 'self_approved', 'pending', 'approved', 'rejected'], default: 'none' },
    tier:          { type: Number, min: 1, max: 3, default: null },
    approval:      { type: mongoose.Schema.Types.ObjectId, ref: 'Approval', default: null },
    decidedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt:     { type: Date, default: null },
  },

  /* ── Proposal / quotation (doc 2, SA-EX-06) ────────────────────────────────
     Version is what makes "Proposal v2 sent" in the activity timeline mean something;
     the documents themselves are `attachments` with docType proposal|quote, which is
     what the → Negotiation gate already reads. */
  proposal: {
    version:   { type: Number, min: 0, default: 0 },
    sentAt:    { type: Date, default: null },
    sentBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    note:      { type: String, trim: true, default: '' },
  },

  /* ── Commercial Order (doc 2, SA-EX-07 → SA-DIR-09) ────────────────────────
     `poNumber` below is the customer's reference and gates the stage. These record the
     Director's CONFIRMATION, which is the act that triggers Production — separate,
     because an executive submitting a CO and a Director confirming it are two different
     people doing two different things. */
  co: {
    submittedAt:  { type: Date, default: null },
    submittedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    confirmedAt:  { type: Date, default: null },
    confirmedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approval:     { type: mongoose.Schema.Types.ObjectId, ref: 'Approval', default: null },
    poValue:      { type: Number, min: 0, default: 0 },
  },

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

  /* Handoff 1 back-pointer. Written only by processHandoffService; its presence is
     the idempotency check that keeps a retried commercial_order transition
     from minting a second Work Order (H-3). */
  workOrder:     { type: mongoose.Schema.Types.ObjectId, ref: 'WorkOrder', default: null },

  /* Hygiene — never blocks anything; surfaces in the manager review queue. */
  needsReview:   { type: Boolean, default: false },
  reviewIssues:  { type: [String], default: [] },
}, { timestamps: true });

/* Indexes for common query patterns */
LeadSchema.index({ owner: 1, stage: 1 });
LeadSchema.index({ customer: 1, track: 1, stage: 1 });
LeadSchema.index({ track: 1, stage: 1 });
LeadSchema.index({ track: 1, isStage: 1, owner: 1 });
LeadSchema.index({ directorManaged: 1 });
LeadSchema.index({ priority: 1, targetFirstContactAt: 1 });
LeadSchema.index({ refId: 1 });
LeadSchema.index({ 'discount.status': 1 });
LeadSchema.index({ 'co.confirmedAt': 1 });
LeadSchema.index({ lastActivityAt: 1 });
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
  /* An Inside Sales record without an Inside Sales stage is not a valid record: doc 1's
     whole flow keys off `isStage`, and a null one makes the list, the gate and the detail
     page all describe a lead that is in no stage at all. Derived rather than defaulted on
     the path, because `track` can be set after construction. */
  if (this.track === 'inside_sales' && !this.isStage) this.isStage = 'is_new';
  if (this.track !== 'inside_sales') this.isStage = null;

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

/* Virtual: overdue (no contact in >7 days and not closed) */
LeadSchema.virtual('isOverdue').get(function() {
  if (pipeline.TERMINAL_SALES_STAGES.includes(this.stage)) return false;
  const last = this.lastContact || this.lastActivityAt;
  if (!last) return true;
  const days = (Date.now() - new Date(last)) / 86400000;
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
