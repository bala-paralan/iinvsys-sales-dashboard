'use strict';
const mongoose = require('mongoose');

/* Cross-cutting telemetry contract from the PRD: tenant_id, user_id,
   lead_id (where applicable), feature_flag_state, timestamp_utc,
   stable event_name in snake_case. Single tenant for now, so tenantId
   is derived from the user. */
const TelemetrySchema = new mongoose.Schema({
  eventName:        { type: String, required: true, trim: true },
  userId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  leadId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  featureFlagState: { type: mongoose.Schema.Types.Mixed, default: {} },
  metadata:         { type: mongoose.Schema.Types.Mixed, default: {} },
  timestampUtc:     { type: Date, default: Date.now },
}, { timestamps: false });

/* N-12 — retention. Telemetry is append-only, high-volume and never read
   beyond a rolling analysis window, so without a TTL it grows without bound
   and is the collection most likely to fill the disk. `VoiceMemo` already had
   one; this did not. 180 days by default, overridable per deployment. */
const RETENTION_DAYS = Number(process.env.TELEMETRY_RETENTION_DAYS) || 180;
TelemetrySchema.index({ timestampUtc: 1 }, { expireAfterSeconds: RETENTION_DAYS * 86400 });

TelemetrySchema.index({ eventName: 1, timestampUtc: -1 });
TelemetrySchema.index({ userId: 1, timestampUtc: -1 });
TelemetrySchema.index({ leadId: 1 });

module.exports = mongoose.model('Telemetry', TelemetrySchema);
module.exports.RETENTION_DAYS = RETENTION_DAYS;
