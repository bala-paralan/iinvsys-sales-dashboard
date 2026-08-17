'use strict';

const mongoose = require('mongoose');
const {
  NEED_TYPE_KEYS, DISQUALIFY_REASON_KEYS, SPENCO_MAX_PER_DIMENSION,
} = require('../../config/pipeline');

const dim = () => ({ type: Number, min: 0, max: SPENCO_MAX_PER_DIMENSION, default: 0 });

/**
 * SPENCO qualification, scored at the Prospect stage.
 * Size · Potential · Evidence of need · Need type · Competition awareness · Origin of need.
 *
 * `total` and `qualified` are DERIVED in the Lead pre('save') hook from
 * pipeline.spencoTotal / spencoQualified — never trust a client-supplied value.
 * The qualification threshold is assumption A18; see
 * docs/requirements/07-open-questions-and-assumptions.md.
 */
const SpencoSchema = new mongoose.Schema({
  size:                 dim(),
  potential:            dim(),
  evidenceOfNeed:       dim(),
  needType:             dim(),
  competitionAwareness: dim(),
  originOfNeed:         dim(),

  /* Categorical companion to the needType score (assumption A19). */
  needTypeLabel: { type: String, enum: ['', ...NEED_TYPE_KEYS], default: '' },

  total:     { type: Number, min: 0, default: 0 },
  qualified: { type: Boolean, default: false },
  notes:     { type: String, trim: true, default: '' },
  scoredAt:  { type: Date, default: null },
  scoredBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  /* "Disqualified suspects archived with reason code" — archived, never deleted. */
  disqualified:    { type: Boolean, default: false },
  disqualifyReason:{ type: String, enum: ['', ...DISQUALIFY_REASON_KEYS], default: '' },
  disqualifyNote:  { type: String, trim: true, default: '' },
  disqualifiedAt:  { type: Date, default: null },
}, { _id: false });

module.exports = SpencoSchema;
