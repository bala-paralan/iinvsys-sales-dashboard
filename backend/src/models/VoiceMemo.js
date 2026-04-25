'use strict';
const mongoose = require('mongoose');

/* PRD 6 — per-extracted-field storage (mirrors confidence-band pattern from PRD 1) */
const ExtractedFieldSchema = new mongoose.Schema({
  value:        { type: mongoose.Schema.Types.Mixed },
  confidence:   { type: String, enum: ['high','med','low'], default: 'med' },
  corrected:    { type: Boolean, default: false },
  originalValue:{ type: mongoose.Schema.Types.Mixed },
}, { _id: false });

const VoiceMemoSchema = new mongoose.Schema({
  leadId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  recordedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  /* Audio file — path relative to uploads dir; null if client didn't send audio */
  audioPath:       { type: String, default: null },
  audioDurationSec:{ type: Number, default: null },
  /* Transcription */
  transcript:      { type: String, trim: true, default: '' },
  transcriptLang:  { type: String, default: 'en' },
  /* PRD 6 — rule-based structured extraction (mirrors PRD 1's confidence pattern) */
  painPoints:      { type: ExtractedFieldSchema, default: null },
  budgetSignal:    { type: ExtractedFieldSchema, default: null },  /* low/mid/high/unknown */
  timeline:        { type: ExtractedFieldSchema, default: null },
  decisionMakers:  { type: ExtractedFieldSchema, default: null },
  nextStep:        { type: ExtractedFieldSchema, default: null },
  interestLevel:   { type: ExtractedFieldSchema, default: null },  /* cold/warm/hot */
  /* AC4 — retention */
  retentionDays:   { type: Number, default: 90 },
  expiresAt:       { type: Date },
  /* AC7 — PII redaction flag (applied on read) */
  piiRedacted:     { type: Boolean, default: false },
  isPrimary:       { type: Boolean, default: true },
}, { timestamps: true });

VoiceMemoSchema.index({ leadId: 1, createdAt: -1 });
VoiceMemoSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); /* TTL index */

VoiceMemoSchema.pre('save', function(next) {
  if (!this.expiresAt && this.retentionDays) {
    this.expiresAt = new Date(Date.now() + this.retentionDays * 86400000);
  }
  next();
});

module.exports = mongoose.model('VoiceMemo', VoiceMemoSchema);
