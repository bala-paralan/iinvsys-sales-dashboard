'use strict';

/**
 * fieldVisibility.js — fields that must never be serialised to a role that lacks the
 * named permission.
 *
 * Doc 3 states this twice, and states it as a backend requirement:
 *
 *   "Financial data is visible only to the Production Head and Sales Director. This is a
 *    backend access control — not just hidden in the UI but not sent to the engineer's
 *    session at all."
 *
 * Doc 4 says the same of CS Agents and AMC contract values.
 *
 * HARD CONSTRAINT, like config/pipeline.js: pure data, no mongoose, no requires. That is
 * what lets utils/redact.js, the query-layer projections and
 * tests/31-financial-redaction.test.js all read the same list, so there is one answer to
 * "what counts as financial" rather than three that drift.
 *
 * Paths are matched by their LEAF SEGMENT anywhere in a response body, at any depth and
 * through arrays. `workOrder.poValue` redacts `poValue` wherever it appears in a
 * work-order-shaped object — including nested inside a lead, a KPI payload, or a list.
 * Matching on the leaf rather than the full path is deliberate: a new endpoint that
 * embeds a work order somewhere unforeseen is redacted by default, and the failure
 * direction is "too little data" rather than "a leak".
 */

/** leaf field name → the permission required to see it */
const FIELD_PERMISSIONS = {
  /* Sales / deal money */
  value:            'finance.read',
  poValue:          'finance.read',
  unitPrice:        'finance.read',
  standardPrice:    'finance.read',
  marginImpact:     'finance.read',
  discountedPrice:  'finance.read',
  /* Account rollups */
  lifetimeRevenue:  'finance.read',
  pipelineValue:    'finance.read',
  /* Contracts — doc 4 IC-AG-03: a CS Agent sees the AMC but not what it is worth.
     `value` above already covers Contract.value, since matching is by leaf name. */
  contractValue:    'finance.read',
  renewalValue:     'finance.read',
  /* Staff commercial data — a target is someone's number, not an engineer's business */
  target:           'directory.read',
};

/** Every permission this config can demand — the vocabulary check reads this. */
const REQUIRED_PERMISSIONS = [...new Set(Object.values(FIELD_PERMISSIONS))];

module.exports = { FIELD_PERMISSIONS, REQUIRED_PERMISSIONS };
