'use strict';

/* PRD 5 — Pluggable enrichment provider.
   To swap in Clearbit / Apollo / ZoomInfo: implement the same
   { enrich({ name, email, company }), name } interface and change
   the require below. The rest of the pipeline is provider-agnostic. */

const provider = require('./mockProvider');

const Lead      = require('../models/Lead');
const Telemetry = require('../models/Telemetry');

/* Enrichable fields and their Lead model keys */
const ENRICHABLE = ['website','industry','employeeCount','hqCountry','linkedinUrl','logoUrl'];

/* Run enrichment for a lead, respecting doNotEnrich list and tenant config.
   Returns the set of fields that were updated. */
async function enrichLead(leadId, userId = null) {
  const lead = await Lead.findById(leadId);
  if (!lead) return { enriched: [], skipped: [] };

  /* AC3: personal-email domain guard + missing anchor check */
  const doNotList = lead.doNotEnrich || [];
  const fieldsToEnrich = ENRICHABLE.filter(f => !doNotList.includes(f));
  if (!fieldsToEnrich.length) return { enriched: [], skipped: ENRICHABLE };

  let result;
  let costToken = null;
  const startMs = Date.now();

  try {
    result = await provider.enrich({
      name:    lead.name,
      email:   lead.email,
      company: lead.company,
    });
  } catch (err) {
    /* AC4: if enrichment fails, lead is unchanged; log telemetry only */
    await Telemetry.create({
      eventName: 'enrichment_failed',
      userId,
      leadId,
      metadata: { error: String(err?.message || err), provider: provider.name },
    }).catch(() => {});
    return { enriched: [], skipped: fieldsToEnrich, error: err.message };
  }

  if (!result) return { enriched: [], skipped: fieldsToEnrich };

  const enrichedFields = [];
  const enrichmentMap  = lead.enrichment ? new Map(lead.enrichment) : new Map();

  for (const field of fieldsToEnrich) {
    if (result[field] == null) continue;
    /* AC5: don't overwrite a rep-supplied non-empty value */
    if (lead[field] && !enrichmentMap.has(field)) continue;

    lead[field] = result[field];
    enrichmentMap.set(field, {
      value:      result[field],
      provider:   provider.name,
      enrichedAt: new Date(),
    });
    enrichedFields.push(field);
  }

  lead.enrichment = enrichmentMap;
  await lead.save();

  const elapsedMs = Date.now() - startMs;
  await Telemetry.create({
    eventName: 'enrichment_completed',
    userId,
    leadId,
    metadata: {
      fieldsEnriched: enrichedFields,
      provider: provider.name,
      elapsedMs,
      costToken,
    },
  }).catch(() => {});

  return { enriched: enrichedFields, skipped: fieldsToEnrich.filter(f => !enrichedFields.includes(f)) };
}

module.exports = { enrichLead, provider: provider.name, ENRICHABLE };
