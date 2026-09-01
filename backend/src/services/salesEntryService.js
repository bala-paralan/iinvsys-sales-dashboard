'use strict';

const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const pipeline = require('../config/pipeline');
const notify = require('./notificationService');
const audit = require('./auditService');

/**
 * salesEntryService — the ONE way a record enters the SPENCO pipeline.
 *
 * Three separate paths in the specification arrive at the same act:
 *   doc 1 IS-HD-04  an approved Inside Sales handoff
 *   doc 1 IS-DIR-03 the Director's "Bypass IS → Assign to Sales Executive"
 *   doc 4 IC-CSM-04 "Push to Sales as Suspect" when an AMC comes up for renewal
 *
 * They are one function because they must produce identical records — an entry that
 * skips a field depending on which button produced it is a data-quality problem that
 * only shows up months later, in a KPI nobody can reconcile.
 *
 * IDEMPOTENT the same way both process handoffs are: a back-pointer on the source
 * (`originLead.convertedTo`) plus a unique-ish `refId`, so a retried approval adopts the
 * winner rather than minting a second deal.
 */

const YEAR = () => new Date().getFullYear();

function nextRefId(prefix) {
  const rand = Math.floor(Math.random() * 1e4).toString().padStart(4, '0');
  return `${prefix}-${YEAR()}-${rand}`;
}

/** A fresh Inside Sales reference — doc 1 numbers them IS-2026-XXXX. */
const nextIsRefId = () => nextRefId('IS');
/** A fresh Sales reference — doc 2 numbers them SA-2026-XXX. */
const nextSalesRefId = () => nextRefId('SA');

/**
 * Mint a track:'sales' lead.
 *
 * @param {object|null} originLead  the Inside Sales record being converted, if any
 * @param {object} opts { stage, assignee, actor, reason, customer, seed }
 */
async function mintSalesLead(originLead, opts = {}) {
  const {
    stage = 'suspect',
    assignee,
    actor,
    reason = 'entered the Sales pipeline',
    seed = {},
  } = opts;

  if (!assignee) {
    throw Object.assign(new Error('A Sales lead needs an owner'), { code: 'NO_ASSIGNEE' });
  }
  if (!pipeline.SALES_STAGE_KEYS.includes(stage)) {
    throw Object.assign(new Error(`Unknown SPENCO stage '${stage}'`), { code: 'UNKNOWN_STAGE' });
  }

  /* Already converted: return the existing deal rather than minting a second. */
  if (originLead && originLead.convertedTo) {
    const existing = await Lead.findById(originLead.convertedTo);
    if (existing) return { lead: existing, created: false };
  }

  const base = originLead ? originLead.toObject() : {};
  const doc = {
    /* Carried from the source so the Sales Executive does not re-key what Inside Sales
       already established. Doc 1 IS-DIR-03: "The Sales Exec gets everything pre-filled." */
    name: base.name, phone: base.phone, email: base.email || '',
    company: base.company || '', city: base.city || '', state: base.state || '',
    jobTitle: base.jobTitle || '', companyType: base.companyType || '',
    industrySegment: base.industrySegment || '', customer: base.customer || null,
    source: base.source || 'inside_sales_outbound',
    ...seed,

    track: 'sales',
    refId: nextSalesRefId(),
    stage,
    owner: assignee,
    originLead: originLead ? originLead._id : null,
    createdBy: actor ? actor._id : null,
  };

  let lead = null;
  for (let attempt = 0; attempt < 3 && !lead; attempt += 1) {
    try {
      lead = await Lead.create(doc);
    } catch (err) {
      if (err && err.code === 11000) { doc.refId = nextSalesRefId(); continue; }
      throw err;
    }
  }
  if (!lead) throw new Error('could not allocate a unique refId in 3 attempts');

  if (originLead) {
    originLead.convertedTo = lead._id;
    originLead.isStage = pipeline.IS_CONVERTED_STAGE;
    await originLead.save();
  }

  /* The assignee is told directly, not by permission broadcast — doc 1 IS-DIR-03:
     "Assigned person gets instant notification". */
  await notify.notifyUser(assignee, {
    event: 'lead.assigned',
    severity: 'warn',
    title: `New deal assigned: ${lead.name}${lead.company ? ` — ${lead.company}` : ''}`,
    body: `${lead.refId} ${reason}. Stage: ${stage.replace(/_/g, ' ')}.`,
    reason: 'It was assigned to you.',
    entityType: 'lead',
    entityId: lead._id,
  });

  await audit.record({
    action: 'handoff.created',
    entityType: 'lead',
    entityId: lead._id,
    summary: `${lead.refId} entered Sales at ${stage} — ${reason}`,
    meta: {
      refId: lead.refId, stage, owner: String(assignee),
      originLead: originLead ? String(originLead._id) : null, reason,
    },
  }, actor ? { user: actor } : undefined);

  return { lead, created: true };
}

/**
 * Attach a customer account to a lead, creating one if the name is new.
 *
 * The AUTOMATED path in customerService — exact key only, never a fuzzy auto-link. A
 * wrong auto-merge under a unique index is effectively unpickable, and nobody is watching
 * when a handoff guesses.
 */
async function attachCustomer(lead, actor) {
  if (lead.customer) return lead.customer;
  if (!lead.company) return null;

  const customerService = require('./customerService');
  const { customer } = await customerService.findOrCreateCustomer({
    name: lead.company,
    city: lead.city,
    state: lead.state,
    zone: lead.zone,
    accountOwner: lead.owner,
  }, { interactive: false, actorId: actor ? actor._id : null });

  lead.customer = customer._id;
  return customer._id;
}

module.exports = { mintSalesLead, attachCustomer, nextIsRefId, nextSalesRefId };
