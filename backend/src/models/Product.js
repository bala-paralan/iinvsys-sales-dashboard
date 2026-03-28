'use strict';
const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  sku:         { type: String, required: true, unique: true, trim: true, uppercase: true },
  category:    { type: String, enum: ['hardware','software','service','bundle'], required: true },
  price:       { type: Number, required: true, min: 0 },
  description: { type: String, trim: true, default: '' },
  isActive:    { type: Boolean, default: true },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

ProductSchema.index({ category: 1 });
ProductSchema.index({ isActive: 1 });

ProductSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('Product', ProductSchema);
