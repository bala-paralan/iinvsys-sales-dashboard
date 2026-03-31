'use strict';
const { validationResult } = require('express-validator');
const Lead  = require('../models/Lead');
const { ok, created, notFound, forbidden, badRequest, unprocessable, paginated } = require('../utils/response');

/* ── helpers ─────────────────────────────────────────────────────── */

function buildFilter(query, agentScope) {
  const { stage, source, assignedAgent, expo, q, overdue } = query;
  const filter = {};

  /* Agent scoping: agents see only their own leads */
  if (agentScope) filter.assignedAgent = agentScope;
  else if (assignedAgent) filter.assignedAgent = assignedAgent;

  if (stage)  filter.stage  = stage;
  if (source) filter.source = source;
  if (expo)   filter.expo   = expo;
  if (q)      filter.$text  = { $search: q };

  if (overdue === 'true') {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    filter.stage       = { $nin: ['won', 'lost'] };
    filter.$or = [
      { lastContact: { $lt: sevenDaysAgo } },
      { lastContact: null, followUps: { $size: 0 } },
    ];
  }
  return filter;
}

/* ── GET /api/leads ──────────────────────────────────────────────── */

async function listLeads(req, res, next) {
  try {
    const { page = 1, limit = 20, sort = '-createdAt' } = req.query;
    const filter = buildFilter(req.query, req.agentScope);
    const skip   = (parseInt(page) - 1) * parseInt(limit);

    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .populate('assignedAgent', 'name initials color')
        .populate('products', 'name sku price')
        .populate('expo', 'name city')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean({ virtuals: true }),
      Lead.countDocuments(filter),
    ]);
    return paginated(res, leads, total, parseInt(page), parseInt(limit));
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/leads/:id ──────────────────────────────────────────── */

async function getLead(req, res, next) {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('assignedAgent', 'name initials color designation')
      .populate('products', 'name sku price category')
      .populate('expo', 'name city startDate endDate')
      .populate('followUps.agent', 'name initials')
      .lean({ virtuals: true });

    if (!lead) return notFound(res, 'Lead not found');

    /* Agent: can only view own leads */
    if (req.agentScope && String(lead.assignedAgent._id) !== String(req.agentScope)) {
      return forbidden(res, 'Access denied');
    }
    return ok(res, lead);
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/leads ─────────────────────────────────────────────── */

async function createLead(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    /* Referrers: auto-tag expo and source, no agent assignment */
    if (req.referrerExpoId) {
      req.body.expo   = req.referrerExpoId;
      req.body.source = 'expo';
    }

    /* Agents can only create leads assigned to themselves */
    if (req.agentScope) req.body.assignedAgent = req.agentScope;

    const lead = await Lead.create({ ...req.body, createdBy: req.user._id });
    const populated = await Lead.findById(lead._id)
      .populate('assignedAgent', 'name initials color')
      .populate('products', 'name sku price')
      .lean({ virtuals: true });
    return created(res, populated, 'Lead created');
  } catch (err) {
    next(err);
  }
}

/* ── PUT /api/leads/:id ──────────────────────────────────────────── */

async function updateLead(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    const lead = await Lead.findById(req.params.id);
    if (!lead) return notFound(res, 'Lead not found');

    /* Agents can only edit their own leads and only the stage field */
    if (req.agentScope) {
      if (String(lead.assignedAgent) !== String(req.agentScope)) return forbidden(res, 'Access denied');
      const allowed = ['stage', 'notes'];
      Object.keys(req.body).forEach(k => { if (!allowed.includes(k)) delete req.body[k]; });
    }

    Object.assign(lead, req.body);
    await lead.save();

    const populated = await Lead.findById(lead._id)
      .populate('assignedAgent', 'name initials color')
      .populate('products', 'name sku price')
      .lean({ virtuals: true });
    return ok(res, populated, 'Lead updated');
  } catch (err) {
    next(err);
  }
}

/* ── DELETE /api/leads/:id ───────────────────────────────────────── */

async function deleteLead(req, res, next) {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return notFound(res, 'Lead not found');

    if (req.agentScope && String(lead.assignedAgent) !== String(req.agentScope)) {
      return forbidden(res, 'Access denied');
    }
    await Lead.findByIdAndDelete(req.params.id);
    return ok(res, {}, 'Lead deleted');
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/leads/:id/followups ───────────────────────────────── */

async function addFollowUp(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    const lead = await Lead.findById(req.params.id);
    if (!lead) return notFound(res, 'Lead not found');

    if (req.agentScope && String(lead.assignedAgent) !== String(req.agentScope)) {
      return forbidden(res, 'Access denied');
    }

    const followUp = {
      agent: req.user.agentId || req.user._id,
      ...req.body,
      timestamp: new Date(),
    };
    lead.followUps.push(followUp);
    lead.lastContact = new Date();
    await lead.save();

    return created(res, lead.followUps[lead.followUps.length - 1], 'Follow-up logged');
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/leads/bulk ────────────────────────────────────────── */

async function bulkImport(req, res, next) {
  try {
    const { leads } = req.body;
    if (!Array.isArray(leads) || leads.length === 0) {
      return badRequest(res, 'leads array is required');
    }

    const phones    = leads.map(l => l.phone);
    const existing  = await Lead.find({ phone: { $in: phones } }).select('phone').lean();
    const dupPhones = new Set(existing.map(l => l.phone));

    const toInsert  = leads.filter(l => !dupPhones.has(l.phone))
                           .map(l => ({ ...l, createdBy: req.user._id }));

    let inserted = [];
    if (toInsert.length) inserted = await Lead.insertMany(toInsert);

    return ok(res, {
      imported:    inserted.length,
      duplicates:  leads.length - toInsert.length,
      total:       leads.length,
    }, `Imported ${inserted.length} leads`);
  } catch (err) {
    next(err);
  }
}

module.exports = { listLeads, getLead, createLead, updateLead, deleteLead, addFollowUp, bulkImport };
