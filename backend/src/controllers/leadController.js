'use strict';
const { validationResult } = require('express-validator');
const Lead      = require('../models/Lead');
const Telemetry = require('../models/Telemetry');
const { normalizePhone, jaroWinkler, nameCompanyScore } = require('../utils/matching');
const { ok, created, notFound, forbidden, badRequest, unprocessable, paginated } = require('../utils/response');

/* Allow-list of telemetry events from PRD AC8 + cross-cutting contract */
const TELEMETRY_EVENTS = new Set([
  'scan_started', 'scan_completed', 'scan_saved', 'scan_abandoned',
  'scan_field_confidence_band', 'scan_field_corrected', 'scan_save_with_low_confidence',
  'scan_dedupe_match_found', 'scan_dedupe_action', 'scan_dedupe_false_positive',
  'scan_dedupe_save_anyway',
]);

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
    const { page = 1, limit = 500, sort = '-createdAt' } = req.query;
    const filter = buildFilter(req.query, req.agentScope);

    /* Referrers see all leads for their expo only */
    if (req.referrerExpoId) filter.expo = req.referrerExpoId;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .populate('assignedAgent', 'name initials color')
        .populate('products', 'name sku price')
        .populate('expo', 'name city')
        .populate('createdBy', 'name role')
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
      .populate('createdBy', 'name role')
      .populate('followUps.agent', 'name initials')
      .lean({ virtuals: true });

    if (!lead) return notFound(res, 'Lead not found');

    /* Referrer: can only view leads for their expo */
    if (req.referrerExpoId && String(lead.expo?._id || lead.expo) !== String(req.referrerExpoId)) {
      return forbidden(res, 'Access denied');
    }

    /* Agent: can only view own leads */
    if (req.agentScope && String(lead.assignedAgent?._id || lead.assignedAgent) !== String(req.agentScope)) {
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

    /* Referrers can only edit leads they created, limited fields */
    if (req.user.role === 'referrer') {
      if (String(lead.createdBy) !== String(req.user._id)) return forbidden(res, 'Access denied');
      const allowed = ['name', 'phone', 'email', 'notes', 'stage'];
      Object.keys(req.body).forEach(k => { if (!allowed.includes(k)) delete req.body[k]; });
    }

    /* Agents can only edit their own assigned leads, limited fields */
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

/* ── POST /api/leads/check-duplicate ─────────────────────────────
   PRD 4 AC1-3. Returns ranked matches; <300ms in-memory match path. */
async function checkDuplicate(req, res, next) {
  try {
    const { name = '', phone = '', email = '', company = '' } = req.body || {};
    if (!name && !phone && !email) return ok(res, { matches: [] });

    const normPhone = phone ? normalizePhone(phone) : null;
    const normEmail = (email || '').trim().toLowerCase();

    /* AC2: exact phone or email → STRONG; pull single best.
       Build candidate set: every lead with same email, same normalized phone,
       or whose name shares the first letter of incoming name (cheap pre-filter
       to bound the in-memory fuzzy pass). */
    const candidateFilter = { $or: [] };
    if (normEmail) candidateFilter.$or.push({ email: normEmail });
    /* For phone we match on the last 10 digits — cheap and tolerant of
       formatting variance in stored data. */
    if (normPhone) {
      const last10 = normPhone.replace(/\D/g, '').slice(-10);
      if (last10.length === 10) candidateFilter.$or.push({ phone: { $regex: last10 + '$' } });
    }
    if (name) {
      const firstChar = name.trim().charAt(0);
      if (firstChar) candidateFilter.$or.push({ name: { $regex: '^' + firstChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } });
    }

    /* Respect agent scoping; managers see all */
    if (req.agentScope) candidateFilter.assignedAgent = req.agentScope;

    const candidates = await Lead.find(candidateFilter)
      .populate('assignedAgent', 'name initials')
      .populate('expo', 'name')
      .limit(200)
      .lean({ virtuals: true });

    const matches = [];
    for (const c of candidates) {
      let strength = null;
      let reason = '';
      const cPhoneLast10 = (c.phone || '').replace(/\D/g, '').slice(-10);
      const phoneLast10  = normPhone ? normPhone.replace(/\D/g, '').slice(-10) : '';

      if (normEmail && c.email && c.email === normEmail)         { strength = 'strong'; reason = 'email'; }
      else if (phoneLast10 && cPhoneLast10 === phoneLast10)      { strength = 'strong'; reason = 'phone'; }
      else if (name) {
        const score = nameCompanyScore({ aName: name, aCompany: company, bName: c.name, bCompany: c.company || '' });
        if (score >= 0.9) { strength = 'weak'; reason = 'name+company'; }
        if (strength) c.matchScore = score;
      }
      if (strength) matches.push({
        lead: {
          id: c._id, name: c.name, phone: c.phone, email: c.email, company: c.company || '',
          stage: c.stage, assignedAgent: c.assignedAgent || null, expo: c.expo || null,
          createdAt: c.createdAt, score: c.matchScore || 1,
        },
        strength, reason,
      });
    }

    /* Strong matches first; for ties, newer first. AC3: top 3 weak. */
    matches.sort((a, b) => {
      if (a.strength !== b.strength) return a.strength === 'strong' ? -1 : 1;
      return new Date(b.lead.createdAt) - new Date(a.lead.createdAt);
    });
    const strong = matches.filter(m => m.strength === 'strong').slice(0, 1);
    const weak   = matches.filter(m => m.strength === 'weak').slice(0, 3);
    return ok(res, { matches: [...strong, ...weak] });
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/leads/:id/merge ───────────────────────────────────
   PRD 4 AC4-5. Per-field winners + activity-history preservation. */
async function mergeLead(req, res, next) {
  try {
    const { sourceId, fieldChoices = {} } = req.body || {};
    if (!sourceId) return badRequest(res, 'sourceId is required');

    const target = await Lead.findById(req.params.id);
    const source = await Lead.findById(sourceId);
    if (!target || !source) return notFound(res, 'Lead(s) not found');

    /* RBAC: agents can only merge into their own leads */
    if (req.agentScope && String(target.assignedAgent) !== String(req.agentScope)) {
      return forbidden(res, 'Access denied');
    }

    /* Apply per-field choices: 'target' keeps existing, 'source' overwrites,
       missing key defaults to newest non-empty value. */
    const mergeable = ['name','phone','email','company','notes','value','stage'];
    for (const f of mergeable) {
      const choice = fieldChoices[f];
      if (choice === 'source' && source[f] !== undefined && source[f] !== null && source[f] !== '') {
        target[f] = source[f];
      } else if (!choice && (target[f] === undefined || target[f] === '' || target[f] === null) && source[f]) {
        target[f] = source[f];
      }
    }

    /* AC5: migrate followUps and union products */
    target.followUps.push(...source.followUps);
    const productSet = new Set([...(target.products || []).map(String), ...(source.products || []).map(String)]);
    target.products  = Array.from(productSet);
    if (source.lastContact && (!target.lastContact || source.lastContact > target.lastContact)) {
      target.lastContact = source.lastContact;
    }

    await target.save();
    await Lead.findByIdAndDelete(sourceId);

    const populated = await Lead.findById(target._id)
      .populate('assignedAgent', 'name initials color')
      .populate('products', 'name sku price')
      .lean({ virtuals: true });
    return ok(res, populated, 'Leads merged');
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/leads/telemetry ───────────────────────────────────
   PRD AC8 + cross-cutting telemetry. Allow-listed event names only. */
async function logTelemetry(req, res, next) {
  try {
    const { eventName, leadId, metadata = {}, featureFlagState = {} } = req.body || {};
    if (!eventName || !TELEMETRY_EVENTS.has(eventName)) {
      return badRequest(res, 'Unknown or missing eventName');
    }
    await Telemetry.create({
      eventName,
      userId:           req.user?._id,
      leadId:           leadId || null,
      metadata,
      featureFlagState,
    });
    return ok(res, { logged: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listLeads, getLead, createLead, updateLead, deleteLead, addFollowUp, bulkImport,
  checkDuplicate, mergeLead, logTelemetry,
};
