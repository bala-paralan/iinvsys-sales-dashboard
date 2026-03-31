'use strict';
const mongoose = require('mongoose');

/* ── Per-setting schema ─────────────────────────────────────────── */
const SettingSchema = new mongoose.Schema({
  key:         { type: String, required: true, unique: true, trim: true },
  value:       { type: mongoose.Schema.Types.Mixed, required: true },
  label:       { type: String, trim: true },        // human-readable label
  description: { type: String, trim: true },
  type:        { type: String, enum: ['string','number','boolean','array','object'], default: 'string' },
  group:       { type: String, trim: true, default: 'general' }, // grouping for UI
  updatedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

SettingSchema.index({ group: 1 });

SettingSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('Setting', SettingSchema);
