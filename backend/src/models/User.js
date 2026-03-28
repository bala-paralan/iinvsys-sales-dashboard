'use strict';
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6, select: false },
  role:     { type: String, enum: ['superadmin','manager','agent','readonly'], default: 'agent' },
  agentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', default: null },
  isActive: { type: Boolean, default: true },
  lastLogin:{ type: Date },
}, { timestamps: true });

/* Indexes */
UserSchema.index({ role: 1 });

/* Hash password before save */
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

/* Compare password */
UserSchema.methods.comparePassword = function(plain) {
  return bcrypt.compare(plain, this.password);
};

/* Strip sensitive fields from JSON */
UserSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', UserSchema);
