'use strict';

const Customer = require('../models/Customer');
const Lead     = require('../models/Lead');
const Activity = require('../models/Activity');
const { jaroWinkler } = require('../utils/matching');

/* Legal-form suffixes that carry no identity. "BEL Sensors Pvt Ltd" and "BEL Sensors"
   are the same account; "BEL Sensors" and "BEL Defence" are not, which is why the city
   is part of the key and the fuzzy pass exists on top. */
const SUFFIXES = /\b(pvt|private|ltd|limited|llp|inc|incorporated|corp|corporation|co|company|plc|gmbh)\b/g;

/** Lowercase, strip punctuation and legal suffixes, collapse space, append the city. */
function normalizeKey(name, city = '') {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const c = String(city || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return c ? `${base}|${c}` : base;
}

const FUZZY_THRESHOLD = 0.92;

/**
 * Customers whose name or alias is close to `name` in the same city.
 *
 * Reuses utils/matching.js — the Jaro-Winkler already backing
 * POST /api/leads/check-duplicate — so there is one similarity implementation, and the
 * response shape mirrors that endpoint's so one duplicate-warning component serves both.
 */
async function findCandidates(name, city = '') {
  if (!name) return [];
  const filter = { status: { $ne: 'lost' }, mergedInto: null };
  if (city) filter.city = new RegExp(`^${String(city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

  const rows = await Customer.find(filter).select('name aliases city domain accountOwner').lean();
  const target = String(name).toLowerCase();

  return rows
    .map((c) => {
      const names = [c.name, ...(c.aliases || [])];
      const score = Math.max(...names.map((n) => jaroWinkler(target, String(n).toLowerCase())));
      return { customer: c, score };
    })
    .filter((r) => r.score >= FUZZY_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}

/**
 * Resolve a company name to a Customer.
 *
 * TWO PATHS, deliberately different:
 *
 *   interactive: true  — a human is at a form. Near-matches are RETURNED, not linked, so
 *                        the person decides. Same contract as check-duplicate.
 *   interactive: false — an automated caller (a handoff, the AMC renewal push-back, the
 *                        CO trigger). Exact normalizedKey only. A wrong fuzzy auto-merge
 *                        under a unique index is effectively unpickable afterwards, and
 *                        no one is watching when a cron job guesses.
 *
 * @returns {{customer: Document|null, created: boolean, candidates: Array}}
 */
async function findOrCreateCustomer(input, { interactive = false, actorId = null } = {}) {
  const name = String(input.name || '').trim();
  if (!name) throw Object.assign(new Error('Customer name is required'), { code: 'CUSTOMER_NAME_REQUIRED' });

  const normalizedKey = normalizeKey(name, input.city);
  const exact = await Customer.findOne({ normalizedKey });
  if (exact) return { customer: exact, created: false, candidates: [] };

  if (interactive) {
    const candidates = await findCandidates(name, input.city);
    if (candidates.length) return { customer: null, created: false, candidates };
  }

  /* The unique index on normalizedKey is the real guard: two concurrent handoffs for the
     same account race here, and the loser must adopt the winner rather than fail. */
  try {
    const customer = await Customer.create({
      name,
      normalizedKey,
      city: input.city || '',
      state: input.state || '',
      zone: input.zone || '',
      domain: input.domain || 'none',
      industrySegment: input.industrySegment || '',
      companyType: input.companyType || '',
      accountOwner: input.accountOwner || null,
      accountManager: input.accountManager || null,
      contacts: input.contacts || [],
      createdBy: actorId,
    });
    return { customer, created: true, candidates: [] };
  } catch (err) {
    if (err && err.code === 11000) {
      const winner = await Customer.findOne({ normalizedKey });
      if (winner) return { customer: winner, created: false, candidates: [] };
    }
    throw err;
  }
}

/**
 * Customer 360 — doc 1 IS-DIR-04 and doc 2 SA-DIR-06.
 *
 * Every figure is computed here rather than stored on the document. The alternative is
 * cache invalidation across four modules for numbers that are one aggregation away, and
 * a stored counter that is wrong is worse than a computed one that is slow.
 */
async function customer360(customerId) {
  const customer = await Customer.findById(customerId)
    .populate('accountOwner', 'name role domain')
    .populate('accountManager', 'name role domain');
  if (!customer) return null;

  const [leads, activities, activityCount, lastActivity] = await Promise.all([
    Lead.find({ customer: customerId })
      .select('refId track stage value opportunityName owner createdAt expectedCloseDate')
      .populate('owner', 'name role')
      .sort({ createdAt: -1 })
      .lean(),
    Activity.find({ customer: customerId })
      .populate('by', 'name role')
      .sort({ occurredAt: -1 })
      .limit(100)
      .lean(),
    Activity.countDocuments({ customer: customerId }),
    Activity.findOne({ customer: customerId }).sort({ occurredAt: -1 }).select('occurredAt').lean(),
  ]);

  const openLeads = leads.filter((l) => !['commercial_order', 'order_lost'].includes(l.stage));
  const won = leads.filter((l) => l.stage === 'commercial_order');

  return {
    customer,
    /* Derived, never stored. */
    metrics: {
      activeDeals: openLeads.filter((l) => l.track === 'sales').length,
      activeInsideSalesLeads: openLeads.filter((l) => l.track === 'inside_sales').length,
      lifetimeRevenue: won.reduce((sum, l) => sum + (l.value || 0), 0),
      totalInteractions: activityCount,
      lastContact: lastActivity ? lastActivity.occurredAt : null,
    },
    leads,
    timeline: activities,
  };
}

module.exports = { normalizeKey, findCandidates, findOrCreateCustomer, customer360, FUZZY_THRESHOLD };
