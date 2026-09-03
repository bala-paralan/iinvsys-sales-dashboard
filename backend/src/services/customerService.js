'use strict';
const mongoose = require('mongoose');

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

  /* Required lazily: doc 4's models load doc 4's config, and customerService is required
     by the Phase 0 handoff path. A top-level require here makes the two circular. */
  const Ticket = require('../models/Ticket');
  const Contract = require('../models/Contract');

  const [leads, activities, byType, lastActivity, tickets, contracts] = await Promise.all([
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
    /* Doc 2 SA-DIR-06 labels its filter tabs with counts — "Calls (8) Emails (10)
       Visits (4)" — and those are over ALL activity on the account, not the 100 most
       recent the timeline holds. Counting the returned page would understate a busy
       account exactly when the number matters most. */
    Activity.aggregate([
      { $match: { customer: new mongoose.Types.ObjectId(String(customerId)) } },
      { $group: { _id: '$type', n: { $sum: 1 } } },
    ]),
    Activity.findOne({ customer: customerId }).sort({ occurredAt: -1 }).select('occurredAt').lean(),
    /* SA-DIR-06's "Open CS Tickets 2" tile and its CS Tickets tab. */
    Ticket.find({ customer: customerId })
      .select('ref subject status priority raisedAt slaDueAt resolvedAt assignedTo')
      .populate('assignedTo', 'name role')
      .sort({ raisedAt: -1 })
      .limit(50)
      .lean(),
    /* "AMC Status — Active till Sep 26". */
    Contract.find({ customer: customerId })
      .select('ref type status startsAt expiresAt value renewalValue product')
      .sort({ expiresAt: -1 })
      .lean(),
  ]);

  const openLeads = leads.filter((l) => !['commercial_order', 'order_lost'].includes(l.stage));
  const won = leads.filter((l) => l.stage === 'commercial_order');
  const counts = new Map(byType.map((r) => [r._id, r.n]));
  const openTickets = tickets.filter((t) => !['resolved', 'closed'].includes(t.status));
  /* The one that expires LAST is the account's AMC status — an expired 2024 contract
     beside a live 2026 one does not make the account uncovered. */
  const amc = contracts.find((c) => c.status === 'active' || c.status === 'expiring')
    || contracts[0] || null;

  return {
    customer,
    /* Derived, never stored. */
    metrics: {
      activeDeals: openLeads.filter((l) => l.track === 'sales').length,
      activeInsideSalesLeads: openLeads.filter((l) => l.track === 'inside_sales').length,
      lifetimeRevenue: won.reduce((sum, l) => sum + (l.value || 0), 0),
      totalInteractions: byType.reduce((sum, r) => sum + r.n, 0),
      lastContact: lastActivity ? lastActivity.occurredAt : null,
      openTickets: openTickets.length,
      /* Per SA-DIR-06's tabs. `meeting`, `whatsapp` and `note` are counted too even
         though the mockup draws three, because omitting a type would make the tab counts
         disagree with the timeline the reader is looking at. */
      byType: {
        call: counts.get('call') || 0,
        email: counts.get('email') || 0,
        visit: counts.get('visit') || 0,
        whatsapp: counts.get('whatsapp') || 0,
        meeting: counts.get('meeting') || 0,
        note: counts.get('note') || 0,
      },
      amc: amc ? {
        ref: amc.ref, type: amc.type, status: amc.status,
        expiresAt: amc.expiresAt, value: amc.value,
      } : null,
    },
    leads,
    timeline: activities,
    tickets,
    contracts,
  };
}

module.exports = { normalizeKey, findCandidates, findOrCreateCustomer, customer360, FUZZY_THRESHOLD };
