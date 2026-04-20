'use strict';
const { Schema, model } = require('mongoose');

const emailConfigSchema = new Schema(
  {
    recipients: {
      type: [{ type: String, trim: true, lowercase: true }],
      default: [],
    },
    periodicity: {
      type: String,
      enum: ['disabled', 'daily', 'weekly', 'monthly'],
      default: 'disabled',
    },
    sendTime: {
      // HH:MM in 24-h format, used by scheduler
      type: String,
      default: '08:00',
      match: /^\d{2}:\d{2}$/,
    },
    template: {
      subject: { type: String, default: 'IINVSYS Sales Report – {{date}}' },
      body: {
        type: String,
        default:
          'Hi Team,\n\nPlease find the attached sales report for {{period}}.\n\nThis email was sent automatically by IINVSYS.\n\nRegards,\nIINVSYS System',
      },
    },
    lastSentAt: { type: Date, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

module.exports = model('EmailConfig', emailConfigSchema);
