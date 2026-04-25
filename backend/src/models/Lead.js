'use strict';
const mongoose = require('mongoose');

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

const LeadSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true },
  phone:         { type: String, required: true, trim: true },
  email:         { type: String, lowercase: true, trim: true, default: '' },
  company:       { type: String, trim: true, default: '' },
  source:        { type: String, enum: ['expo','referral','direct','digital'], required: true },
  expo:          { type: mongoose.Schema.Types.ObjectId, ref: 'Expo', default: null },
  stage:         { type: String, enum: ['new','contacted','interested','proposal','negotiation','won','lost'], default: 'new' },
  assignedAgent: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', default: null },
  products:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  value:         { type: Number, default: 0, min: 0 },
  score:         { type: Number, default: 50, min: 0, max: 100 },
  notes:         { type: String, trim: true, default: '' },
  lostReason:    { type: String, trim: true, default: '' },
  isReEngage:    { type: Boolean, default: false },
  followUps:     [FollowUpSchema],
  lastContact:   { type: Date, default: null },
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ocrCapture:    { type: OcrCaptureSchema, default: null },
  dupeOverride:  { type: DupeOverrideSchema, default: null },
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
/* Text search */
LeadSchema.index({ name: 'text', phone: 'text', email: 'text' });

/* Virtual: followUp count */
LeadSchema.virtual('followUpCount').get(function() {
  return this.followUps.length;
});

/* Virtual: overdue (no contact in >7 days and not closed) */
LeadSchema.virtual('isOverdue').get(function() {
  if (['won','lost'].includes(this.stage)) return false;
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
