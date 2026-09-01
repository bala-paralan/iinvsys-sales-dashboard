'use strict';
/**
 * Notification — R-8.
 *
 * docs/requirements/03-stage-gates.md ends with a thirteen-row table of
 * triggers, recipients and severities ("Delay logged with noticeHours < 48 →
 * Delivery Manager, Sales owner, manager → critical → email"). None of it
 * existed: the UI's bell icon and "● LIVE" badge were decorative markup.
 *
 * ── Recipients resolve by PERMISSION, never by role name ─────────────────
 * The framework names ten operational roles and this system maps them onto
 * thirteen. Addressing an alert to `role: 'delivery_manager'` bakes one of
 * those mappings into every call site, so the day a client splits or merges a
 * role, every trigger silently stops reaching someone. Addressing it to
 * `permission: 'workorder.accept'` keeps working, because the permission
 * matrix is the thing that actually defines who does that job.
 */
const mongoose = require('mongoose');

const SEVERITIES = ['info', 'warn', 'critical'];

/* Kept as a vocabulary so a notification centre can filter, and so a typo
   cannot invent an event nobody ever queries. Mirrors the trigger table. */
const NOTIFICATION_EVENTS = [
  /* Sales */
  'lead.stage_advanced',
  'lead.gate_overridden',
  'lead.inactive',
  'lead.notes_stale',
  'lead.needs_review',
  /* Handoffs */
  'handoff.workorder_created',
  'handoff.installation_created',
  /* Delivery */
  'delivery.date_unconfirmed',
  'delivery.delay_logged',
  'delivery.delay_late_notice',
  'delivery.date_revised',
  /* Installation & CS */
  'install.commissioning_failed',
  'install.handover_complete',
  'install.issue_sla_breached',
  'install.csat_low',
  'install.corrective_action_overdue',
  /* Approvals — doc 1 IS-HD-04, doc 2 SA-MGR-08 / SA-DIR-09, doc 3 PD-HD-07,
     doc 4 IC-HD-04. Addressed to ONE person (Approval.assignedTo), never broadcast
     to every holder of a permission. */
  'approval.requested',
  'approval.decided',
  'approval.escalated',
  /* Org / assignment — doc 1 IS-DIR-03: "Assigned person gets instant notification". */
  'lead.assigned',
  /* Activity compliance — doc 2: "If you don't log for 24h, your Manager gets an alert." */
  'activity.none_logged',
];

const NotificationSchema = new mongoose.Schema({
  event:    { type: String, enum: NOTIFICATION_EVENTS, required: true, index: true },
  severity: { type: String, enum: SEVERITIES, default: 'info', index: true },

  title: { type: String, required: true, trim: true },
  body:  { type: String, trim: true, default: '' },

  /* What this is about, so the client can deep-link to it. */
  entityType: { type: String, enum: ['lead', 'workorder', 'installation', 'approval', 'customer', 'user'], default: null },
  entityId:   { type: mongoose.Schema.Types.ObjectId, default: null },

  /* Exactly one recipient per document. Fanning out at write time rather than
     storing a recipient array keeps "mark as read" a single-document update
     and per-user unread counts a plain indexed count. */
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  /* Why this person received it — invaluable when someone asks
     "why am I being told about this?" */
  reason: { type: String, default: '' },

  readAt:    { type: Date, default: null },
  emailSent: { type: Boolean, default: false },

  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

/* The two queries the notification centre makes. */
NotificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });
NotificationSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
/* De-duplication: a nightly sweep must not re-notify the same person about the
   same record every single night. See notificationService.notifyOnce(). */
NotificationSchema.index({ user: 1, event: 1, entityId: 1, createdAt: -1 });

NotificationSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

const Notification = mongoose.model('Notification', NotificationSchema);

module.exports = Notification;
module.exports.SEVERITIES = SEVERITIES;
module.exports.NOTIFICATION_EVENTS = NOTIFICATION_EVENTS;
