'use strict';

const mongoose = require('mongoose');
const { DOC_TYPE_KEYS } = require('../../config/pipeline');

/**
 * One uploaded document. Embedded identically by Lead, WorkOrder and
 * InstallationJob so that pipeline.hasDoc(doc, type) works against all three.
 *
 * The bytes never live here — `driver` + `storageKey` point into
 * utils/fileStore.js, which defaults to GridFS so the same code path works on
 * Vercel's ephemeral filesystem and on-prem Docker alike.
 *
 * Document gates (PO before Commercial Order, DA before Delivered, Handover
 * Certificate before Handed Over) are all expressed as `hasDoc:<docType>` tests
 * in config/pipeline.js.
 */
const AttachmentSchema = new mongoose.Schema({
  docType:    { type: String, enum: DOC_TYPE_KEYS, required: true, index: true },
  filename:   { type: String, required: true, trim: true },
  mimeType:   { type: String, required: true },
  sizeBytes:  { type: Number, required: true, min: 0 },
  driver:     { type: String, required: true, default: 'gridfs' },
  storageKey: { type: String, required: true },
  sha256:     { type: String, default: '' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  uploadedAt: { type: Date, default: Date.now },
  note:       { type: String, trim: true, default: '' },
}, { _id: true });

module.exports = AttachmentSchema;
