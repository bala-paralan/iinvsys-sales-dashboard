'use strict';
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
/* Single source of truth for the role list. `permissions.js` and `pipeline.js` have no
   mongoose dependency, so importing them here cannot create a require cycle.
   See docs/requirements/04-roles-and-permissions.md. */
const { ALL_ROLES } = require('../config/permissions');
const { DOMAIN_KEYS } = require('../config/pipeline');

/**
 * User is the ONLY identity model.
 *
 * v2 carried a second one — `Agent` — and `Lead.owner` pointed at it while an
 * unpopulated `Lead.owner` pointed here. The V3 org chart is a graph of Users, and a
 * hierarchy resolver that returns User ids cannot filter a column of Agent ids. `Agent`
 * is retired; its sales-profile fields live below.
 */
const UserSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6, select: false },
  role:     { type: String, enum: ALL_ROLES, default: 'sales_executive' },

  /* ── Org chart (ERP Bible V3) ───────────────────────────────────────────────
     `chain` is the materialised list of ancestors, root-first, maintained by
     services/orgService.js. It is what turns "everyone reporting to me, at any
     depth" into ONE indexed query — User.find({ chain: myId }) — instead of a
     recursive walk on every list request. It is derived state: never set it by
     hand, always go through orgService.setManager(). */
  reportsTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  chain:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  /* Doc 2: one Sales Manager per domain, two Executives each. A labelling and
     routing attribute — visibility is decided by the reporting line, not by this. */
  domain:    { type: String, enum: DOMAIN_KEYS, default: 'none' },

  /* ── Sales profile, absorbed from the retired `Agent` model ────────────────── */
  initials:    { type: String, trim: true, maxlength: 3 },
  phone:       { type: String, trim: true },
  territory:   { type: String, trim: true },
  designation: { type: String, trim: true },
  target:      { type: Number, default: 0, min: 0 },   // monthly target in ₹
  color:       { type: String, default: 'var(--gold)' },
  joinDate:    { type: Date, default: Date.now },

  /* ── Referrer-specific ─────────────────────────────────────────────────────── */
  expoId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Expo', default: null },
  expiresAt:   { type: Date, default: null },   // null = never expires
  isTemporary: { type: Boolean, default: false },

  isActive:    { type: Boolean, default: true },
  lastLogin:   { type: Date },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

/* Indexes. `chain` is multikey — it carries the whole subtree query. */
UserSchema.index({ role: 1, isActive: 1 });
UserSchema.index({ reportsTo: 1 });
UserSchema.index({ chain: 1 });
UserSchema.index({ domain: 1 });

/* Derive initials from the name when not given, so the seed and the invite flow
   never have to. Two letters from the first two words, upper-cased. */
UserSchema.pre('validate', function(next) {
  if (!this.initials && this.name) {
    this.initials = this.name.trim().split(/\s+/).slice(0, 2)
      .map((w) => w[0]).join('').toUpperCase().slice(0, 3);
  }
  next();
});

/*
 * Hash password before save.
 *
 * COST FACTOR. Production uses 12. The test suite uses 4, and that is a deliberate
 * decision rather than a shortcut: `bcryptjs` is a pure-JS implementation roughly an
 * order of magnitude slower than the native binding, so a cost-12 hash costs on the
 * order of a second here. While Agent was a separate collection its fixtures paid
 * nothing; retiring it (D-1) routed every lead-owner fixture through User.create(),
 * which put two such hashes inside a `beforeEach` that runs 88 times in
 * 02-leads-agents alone. The result was a suite that ran for forty minutes and tripped
 * Jest's 30s hook timeout on whichever block happened to be unlucky — a green/red
 * signal decided by machine load rather than by the code under test.
 *
 * Lowering the cost in tests does not weaken any assertion: nothing asserts on the cost
 * factor, and comparePassword() verifies a cost-4 hash exactly as it verifies a cost-12
 * one. What it must never do is leak into a real deployment, hence reading NODE_ENV
 * rather than an env var an operator could set by accident.
 */
const BCRYPT_ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;

UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);
  next();
});

/* Compare password */
UserSchema.methods.comparePassword = function(plain) {
  return bcrypt.compare(plain, this.password);
};

/* `Agent.status` was an 'active'|'inactive' string; `User.isActive` is a boolean. The
   legacy root app reads `status`, and /api/agents is still mounted for it, so expose both
   rather than making the client care which model it is talking to. */
UserSchema.virtual('status')
  .get(function() { return this.isActive ? 'active' : 'inactive'; })
  .set(function(v) { this.isActive = v !== 'inactive'; });

UserSchema.set('toJSON', { virtuals: true });
UserSchema.set('toObject', { virtuals: true });

/* Strip sensitive fields from JSON */
UserSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', UserSchema);
