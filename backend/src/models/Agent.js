'use strict';
const mongoose = require('mongoose');

const AgentSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  initials:    { type: String, required: true, trim: true, maxlength: 3 },
  email:       { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:       { type: String, required: true, trim: true },
  territory:   { type: String, required: true, trim: true },
  designation: { type: String, default: 'Sales Executive', trim: true },
  status:      { type: String, enum: ['active','inactive'], default: 'active' },
  target:      { type: Number, default: 0, min: 0 },  // monthly target in ₹
  color:       { type: String, default: 'var(--gold)' },
  joinDate:    { type: Date, default: Date.now },
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // linked login
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

AgentSchema.index({ status: 1 });
AgentSchema.index({ territory: 1 });

AgentSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('Agent', AgentSchema);
