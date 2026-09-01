'use strict';
const { validationResult } = require('express-validator');
const Customer = require('../models/Customer');
const Lead     = require('../models/Lead');
const Activity = require('../models/Activity');
const { ok, created, notFound, unprocessable, paginated, badRequest, conflict } = require('../utils/response');
const { parsePaging } = require('../utils/pagination');
const customerService = require('../services/customerService');
const audit = require('../services/auditService');

/* ── GET /api/customers ──────────────────────────────────────────── */

async function listCustomers(req, res, next) {
  try {
    const { domain, city, status, q, mine } = req.query;
    const filter = { mergedInto: null };
    if (domain) filter.domain = domain;
    if (city)   filter.city   = new RegExp(String(city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (status) filter.status = status;
    if (q)      filter.name   = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    /* Customers are shared reference data — a Director briefing before a meeting needs
       any account. `?mine=true` narrows to the caller's book when a screen wants that. */
    if (mine === 'true') filter.accountOwner = req.user._id;

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 50 });
    const [rows, total] = await Promise.all([
      Customer.find(filter)
        .populate('accountOwner', 'name role')
        .populate('accountManager', 'name role')
        .sort({ name: 1 }).skip(skip).limit(limit).lean(),
      Customer.countDocuments(filter),
    ]);
    return paginated(res, rows, total, page, limit);
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/customers/:id ──────────────────────────────────────── */

async function getCustomer(req, res, next) {
  try {
    const row = await Customer.findById(req.params.id)
      .populate('accountOwner', 'name role')
      .populate('accountManager', 'name role')
      .lean();
    if (!row) return notFound(res, 'Customer not found');
    return ok(res, row);
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/customers/:id/360 ──────────────────────────────────── */

async function get360(req, res, next) {
  try {
    const view = await customerService.customer360(req.params.id);
    if (!view) return notFound(res, 'Customer not found');
    return ok(res, view);
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/customers/check-duplicate ─────────────────────────── */

/* Advisory, and deliberately separate from create: the person at the form decides
   whether "Integral Coach Factory, Chennai" is the "ICF Chennai" already on file. Same
   contract as POST /api/leads/check-duplicate so one warning component serves both. */
async function checkDuplicate(req, res, next) {
  try {
    const { name, city } = req.body;
    if (!name) return badRequest(res, 'name is required');
    const candidates = await customerService.findCandidates(name, city);
    return ok(res, {
      normalizedKey: customerService.normalizeKey(name, city),
      candidates: candidates.map((c) => ({ ...c.customer, score: Number(c.score.toFixed(3)) })),
    });
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/customers ─────────────────────────────────────────── */

async function createCustomer(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    const interactive = req.body.confirmedNew !== true;
    const result = await customerService.findOrCreateCustomer(req.body, {
      interactive,
      actorId: req.user._id,
    });

    /* Near-matches: answer 409 with the candidates rather than creating a second
       record for the same account. The client re-posts with confirmedNew:true to
       overrule, which is a decision a person has then explicitly made. */
    if (!result.customer) {
      return conflict(res, 'Possible duplicate customer', {
        candidates: result.candidates.map((c) => ({ ...c.customer, score: Number(c.score.toFixed(3)) })),
      });
    }
    if (!result.created) return ok(res, result.customer, 'Existing customer matched');
    return created(res, result.customer, 'Customer created');
  } catch (err) {
    if (err.code === 'CUSTOMER_NAME_REQUIRED') return badRequest(res, err.message);
    next(err);
  }
}

/* ── PUT /api/customers/:id ──────────────────────────────────────── */

async function updateCustomer(req, res, next) {
  try {
    /* normalizedKey is derived and unique — recomputed here when the identity fields
       move, never accepted from the client. */
    const { normalizedKey, mergedInto, ...safe } = req.body;
    const row = await Customer.findById(req.params.id);
    if (!row) return notFound(res, 'Customer not found');

    Object.assign(row, safe);
    if (safe.name || safe.city) row.normalizedKey = customerService.normalizeKey(row.name, row.city);
    await row.save();
    return ok(res, row, 'Customer updated');
  } catch (err) {
    if (err.code === 11000) return conflict(res, 'Another customer already uses that name and city');
    next(err);
  }
}

/* ── POST /api/customers/:id/contacts ────────────────────────────── */

async function addContact(req, res, next) {
  try {
    const row = await Customer.findById(req.params.id);
    if (!row) return notFound(res, 'Customer not found');
    if (!req.body.name) return badRequest(res, 'Contact name is required');

    if (req.body.isPrimary) row.contacts.forEach((c) => { c.isPrimary = false; });
    row.contacts.push({ ...req.body, createdBy: req.user._id });
    await row.save();
    return created(res, row, 'Contact added');
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/customers/:id/merge ───────────────────────────────── */

async function mergeCustomer(req, res, next) {
  try {
    const { into } = req.body;
    if (!into) return badRequest(res, 'into (target customer id) is required');
    if (String(into) === String(req.params.id)) return badRequest(res, 'Cannot merge a customer into itself');

    const [loser, winner] = await Promise.all([
      Customer.findById(req.params.id),
      Customer.findById(into),
    ]);
    if (!loser)  return notFound(res, 'Customer not found');
    if (!winner) return notFound(res, 'Target customer not found');

    /* Move the history first. If the process dies midway the loser is still readable
       and the merge is safe to retry; doing it the other way round would strand
       activities against a customer already marked merged. */
    const [leads, activities] = await Promise.all([
      Lead.updateMany({ customer: loser._id }, { $set: { customer: winner._id } }),
      Activity.updateMany({ customer: loser._id }, { $set: { customer: winner._id } }),
    ]);

    winner.aliases = [...new Set([...(winner.aliases || []), loser.name, ...(loser.aliases || [])])];
    for (const c of loser.contacts) winner.contacts.push({ ...c.toObject(), _id: undefined, isPrimary: false });
    await winner.save();

    loser.mergedInto = winner._id;
    loser.status = 'dormant';
    await loser.save();

    await audit.record({
      action: 'record.merge',
      entityType: 'customer',
      entityId: winner._id,
      after: {
        mergedFrom: loser._id, mergedFromName: loser.name,
        leadsMoved: leads.modifiedCount, activitiesMoved: activities.modifiedCount,
      },
    }, req);

    return ok(res, {
      customer: winner,
      moved: { leads: leads.modifiedCount, activities: activities.modifiedCount },
    }, 'Customers merged');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listCustomers, getCustomer, get360, checkDuplicate,
  createCustomer, updateCustomer, addContact, mergeCustomer,
};
