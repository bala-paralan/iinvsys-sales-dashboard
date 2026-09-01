'use strict';
/**
 * AuditLog — R-7.
 *
 * The Business Process Framework requires stage transitions to be attributable,
 * gate overrides to be visible ("an override is always visible, never silent"),
 * and delay reason codes to survive for monthly review. Before this, the only
 * history in the system was `Lead.followUps[]`, and destructive operations —
 * DELETE /api/leads/:id, hardDeleteAgent, deleteExpo, deleteReferrer, and
 * mergeLead's hard delete of the source lead — were irrecoverable AND unlogged.
 *
 * Append-only: update and delete are blocked at the model layer, not by
 * convention. A log an application can rewrite is not evidence of anything.
 *
 * See docs/requirements/03-stage-gates.md (notification + override rules) and
 * docs/requirements/06-erp-configuration-requirements.md.
 */
const mongoose = require('mongoose');

/* Kept as a flat vocabulary rather than free text so the log is queryable and a
   typo cannot invent a new action that nobody ever greps for. */
const AUDIT_ACTIONS = [
  /* workflow */
  'stage.transition',
  'stage.gate_override',
  'handoff.created',
  /* records */
  'record.create',
  'record.update',
  'record.delete',
  'record.merge',
  /* access */
  'auth.login',
  'auth.login_failed',
  'auth.password_change',
  'user.role_change',
  'user.create',
  /* configuration */
  'settings.rule_change',
  'settings.change',
];

const AUDIT_ENTITIES = [
  'lead', 'workorder', 'installation', 'user', 'expo',
  'product', 'setting', 'notification',
  /* ERP Bible V3 */
  'customer', 'approval',
];

const AuditLogSchema = new mongoose.Schema({
  action:     { type: String, enum: AUDIT_ACTIONS, required: true, index: true },
  entityType: { type: String, enum: AUDIT_ENTITIES, required: true },
  entityId:   { type: mongoose.Schema.Types.ObjectId, default: null },

  /* The actor is DENORMALISED on purpose. A log entry has to stay readable
     after the account it names is deleted — which is exactly the case where
     someone is reading the audit log. */
  actor: {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, default: '' },
    role: { type: String, default: '' },
  },

  /* One line a human can scan without decoding `meta`. */
  summary: { type: String, required: true, trim: true },

  /* Action-specific detail: {from, to} for a transition, `missingAtOverride`
     for a gate override, {before, after} for a settings change. */
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },

  ip:        { type: String, default: '' },
  userAgent: { type: String, default: '' },

  at: { type: Date, default: Date.now, index: true },
}, {
  /* `at` is the timestamp; a second createdAt would be redundant and confusing. */
  timestamps: false,
  minimize: false,
});

/* Query patterns: an entity's history, a person's activity, a period sweep. */
AuditLogSchema.index({ entityType: 1, entityId: 1, at: -1 });
AuditLogSchema.index({ 'actor.user': 1, at: -1 });
AuditLogSchema.index({ action: 1, at: -1 });
AuditLogSchema.index({ at: -1 });

/* ── Append-only enforcement ──────────────────────────────────────────────
   Mongoose offers no "immutable collection" flag, so every mutating path is
   closed explicitly. Missing one would leave a quiet way to rewrite history. */
const IMMUTABLE = 'AuditLog is append-only';

AuditLogSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error(IMMUTABLE));
  next();
});

for (const op of [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne',
  'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove',
]) {
  AuditLogSchema.pre(op, function (next) { next(new Error(IMMUTABLE)); });
}

AuditLogSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

module.exports = AuditLog;
module.exports.AUDIT_ACTIONS  = AUDIT_ACTIONS;
module.exports.AUDIT_ENTITIES = AUDIT_ENTITIES;
