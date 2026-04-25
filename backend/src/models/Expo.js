'use strict';
const mongoose = require('mongoose');

const ExpoProductSchema = new mongoose.Schema({
  product:    { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  presenters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Agent' }],
}, { _id: false });

const ExpoSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  startDate:   { type: Date, required: true },
  endDate:     { type: Date, required: true },
  venue:       { type: String, required: true, trim: true },
  city:        { type: String, required: true, trim: true },
  agents:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'Agent' }],
  products:    [ExpoProductSchema],
  status:      { type: String, enum: ['upcoming','live','past'], default: 'upcoming' },
  targetLeads: { type: Number, default: 0 },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

ExpoSchema.index({ status: 1 });
ExpoSchema.index({ startDate: -1 });

/* Auto-update status based on dates */
ExpoSchema.pre('save', function(next) {
  const now = new Date();
  if (now < this.startDate)      this.status = 'upcoming';
  else if (now <= this.endDate)  this.status = 'live';
  else                           this.status = 'past';
  next();
});

ExpoSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('Expo', ExpoSchema);
