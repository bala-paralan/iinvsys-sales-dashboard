'use strict';
const mongoose = require('mongoose');

/**
 * Task — the "Next Action" every activity form ends with.
 *
 * Doc 1 IS-EX-03 note 2 and doc 2 SA-EX-04: choosing a next action on a logged activity
 * creates a dated task on the owner's dashboard. No manual task creation — "every
 * activity automatically seeds the next action". activityService.logActivity() writes
 * both in one operation and links them back.
 */
const TaskSchema = new mongoose.Schema({
  owner:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  deal:     { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  activity: { type: mongoose.Schema.Types.ObjectId, ref: 'Activity', default: null },

  title:  { type: String, required: true, trim: true },
  type:   { type: String, enum: ['call', 'email', 'visit', 'meeting', 'proposal', 'other'], default: 'other' },
  dueAt:  { type: Date, required: true },
  status: { type: String, enum: ['open', 'done', 'cancelled'], default: 'open' },
  completedAt: { type: Date, default: null },
  note:   { type: String, trim: true, default: '' },

  source:    { type: String, enum: ['activity_next_action', 'manual', 'system'], default: 'manual' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

/* The "Today's Tasks" panel appears on five different role dashboards; this is the
   index that serves all of them. */
TaskSchema.index({ owner: 1, status: 1, dueAt: 1 });
TaskSchema.index({ deal: 1 });
TaskSchema.index({ customer: 1 });
TaskSchema.index({ activity: 1 });

TaskSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('Task', TaskSchema);
