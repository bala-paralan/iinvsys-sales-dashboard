'use strict';
const { validationResult } = require('express-validator');
const multer      = require('multer');
const fileStore   = require('../utils/fileStore');
const Lead        = require('../models/Lead');
const Telemetry   = require('../models/Telemetry');
const { enrichLead, ENRICHABLE } = require('../enrichment');
const { normalizePhone, jaroWinkler, nameCompanyScore } = require('../utils/matching');
const { ok, created, notFound, forbidden, badRequest, unprocessable, gateFailed, paginated } = require('../utils/response');
const { parsePaging } = require('../utils/pagination');
const audit = require('../services/auditService');
const pipeline = require('../config/pipeline');
const { applyTransition, previewGate } = require('../services/stageService');
const { can } = require('../middleware/rbac');
const { nanoid } = (() => {
  try { return require('nanoid'); } catch { return { nanoid: () => Math.random().toString(36).slice(2, 10) }; }
})();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: fileStore.MAX_BYTES },
});

/**
 * Fields the SERVER owns. Stripped from every client payload on create and
 * update, whatever the caller's role.
 *
 * `stageHistory` and `attachments` are the load-bearing pair. A forged
 * stageHistory inflates every Sales conversion KPI, which is computed entirely
 * from it. A forged attachment defeats the document gates outright — the S-8
 * PO gate is `hasDoc:po`, so `PUT { attachments: [{ docType: 'po' }] }` closed
 * a deal with no purchase order on file. Documents now arrive only through
 * POST /:id/upload, which puts real bytes in GridFS first.
 */
const SERVER_OWNED_FIELDS = [
  'stageHistory', 'stageEnteredAt', 'attachments',
  'needsReview', 'reviewIssues', 'workOrder', 'createdBy',
];

function stripServerOwned(body) {
  if (!body || typeof body !== 'object') return body;
  SERVER_OWNED_FIELDS.forEach((f) => delete body[f]);
  return body;
}

/* Allow-list of telemetry events from PRD AC8 + cross-cutting contract */
const TELEMETRY_EVENTS = new Set([
  'scan_started', 'scan_completed', 'scan_saved', 'scan_abandoned',
  'scan_field_confidence_band', 'scan_field_corrected', 'scan_save_with_low_confidence',
  'scan_dedupe_match_found', 'scan_dedupe_action', 'scan_dedupe_false_positive',
  'scan_dedupe_save_anyway',
  'enrichment_completed', 'enrichment_failed', 'enrichment_field_overridden',
  'bulk_scan_saved',
  'scan_language_detected', 'scan_language_mismatch',
  'voice_memo_recorded', 'voice_memo_transcribed', 'voice_memo_field_corrected',
]);

/**
 * Fire enrichment without blocking the response (PRD 5 AC1).
 *
 * Skipped under NODE_ENV=test, deliberately. `setImmediate` schedules a
 * database WRITE that lands after the HTTP response — i.e. after the test that
 * triggered it has already moved on, and potentially after its
 * `clearCollections()`. Background writes racing the next test are a classic
 * source of the kind of intermittent failure that gets dismissed as "flaky"
 * and erodes trust in the whole suite.
 *
 * The explicit `POST /api/leads/:id/enrich` endpoint still runs normally, so
 * enrichment behaviour remains directly tested — just not as a side effect of
 * every unrelated lead creation.
 */
function queueEnrichment(leadId, userId) {
  if (process.env.NODE_ENV === 'test') return;
  setImmediate(() => enrichLead(leadId, userId).catch(() => {}));
}

/* ── helpers ─────────────────────────────────────────────────────── */

function buildFilter(query, agentScope) {
  const { stage, source, assignedAgent, expo, q, overdue,
          city, state, natureOfBusiness, interestedIn } = query;
  const filter = {};

  /* Agent scoping: agents see only their own leads */
  if (agentScope) filter.assignedAgent = agentScope;
  else if (assignedAgent) filter.assignedAgent = assignedAgent;

  if (stage)  filter.stage  = stage;
  if (source) filter.source = source;
  if (expo)   filter.expo   = expo;
  if (q)      filter.$text  = { $search: q };
  if (city)             filter.city             = city;
  if (state)            filter.state            = state;
  if (natureOfBusiness) filter.natureOfBusiness = natureOfBusiness;
  if (interestedIn)     filter.interestedIn     = interestedIn;

  if (overdue === 'true') {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    filter.stage       = { $nin: ['commercial_order', 'order_lost'] };
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
    const { sort = '-createdAt' } = req.query;
    const filter = buildFilter(req.query, req.agentScope);

    /* Referrers see all leads for their expo only */
    if (req.referrerExpoId) filter.expo = req.referrerExpoId;

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 500 });

    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .populate('assignedAgent', 'name initials color')
        .populate('products', 'name sku price')
        .populate('expo', 'name city')
        .populate('createdBy', 'name role')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean({ virtuals: true }),
      Lead.countDocuments(filter),
    ]);
    return paginated(res, leads, total, page, limit);
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

    /* Referrers: auto-tag expo and source, never let the client pick an agent */
    if (req.referrerExpoId) {
      req.body.expo   = req.referrerExpoId;
      req.body.source = 'exhibition_event';
      delete req.body.assignedAgent;
    }

    /* Agents can only create leads assigned to themselves */
    if (req.agentScope) req.body.assignedAgent = req.agentScope;

    const lead = await Lead.create({ ...stripServerOwned(req.body), createdBy: req.user._id });
    /* The model seeded the opening stageHistory entry; name the actor on it. */
    if (lead.stageHistory.length === 1 && !lead.stageHistory[0].by) {
      lead.stageHistory[0].by = req.user._id;
      lead.stageHistory[0].byName = req.user.name || req.user.email || '';
      await lead.save();
    }
    const populated = await Lead.findById(lead._id)
      .populate('assignedAgent', 'name initials color')
      .populate('products', 'name sku price')
      .lean({ virtuals: true });

    /* PRD 5 AC1 — fire enrichment async; rep never blocked */
    queueEnrichment(lead._id, req.user._id);

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

    /* A stage change must go through POST /:id/advance, which runs canAdvance()
       and the entry gate. Allowing it here would make every gate optional —
       `PUT { stage: 'commercial_order' }` would close a deal with no PO, no PO
       number and no AMC answer, which is exactly what S-1 forbids.
       An unchanged stage is a no-op, so an ordinary Save never trips this. */
    if (req.body.stage !== undefined && req.body.stage !== lead.stage) {
      return gateFailed(
        res, 'STAGE_CHANGE_VIA_ADVANCE',
        'Stage changes go through POST /api/leads/:id/advance so the entry gate runs',
        [],
      );
    }
    delete req.body.stage;
    stripServerOwned(req.body);

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
    /* Hard delete with no soft-delete flag anywhere — the audit snapshot is the
       only remaining record that this lead existed. */
    await audit.destruction({
      entityType: 'lead',
      entityId: lead._id,
      label: lead.name,
      snapshot: {
        name: lead.name, phone: lead.phone, email: lead.email, company: lead.company,
        stage: lead.stage, source: lead.source, value: lead.value,
        assignedAgent: lead.assignedAgent, expo: lead.expo, createdAt: lead.createdAt,
      },
    }, req);
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

    /* Referrers capped at 100 rows/request and force-tagged to their expo */
    const REFERRER_BULK_CAP = 100;
    if (req.referrerExpoId && leads.length > REFERRER_BULK_CAP) {
      return badRequest(res, `Referrers can import at most ${REFERRER_BULK_CAP} rows per request (got ${leads.length})`);
    }

    const phones    = leads.map(l => l.phone);
    const existing  = await Lead.find({ phone: { $in: phones } }).select('phone').lean();
    const dupPhones = new Set(existing.map(l => l.phone));

    /* Referrers: hard-restrict the imported field set so nothing in the CSV
       (stage, value, score, enrichment, etc.) can sneak through the spread. */
    const REFERRER_BULK_FIELDS = ['name', 'phone', 'email', 'company', 'notes'];

    const toInsert  = leads.filter(l => !dupPhones.has(l.phone))
                           .map(l => {
                             if (req.referrerExpoId) {
                               const row = { createdBy: req.user._id, expo: req.referrerExpoId, source: 'exhibition_event' };
                               for (const k of REFERRER_BULK_FIELDS) if (l[k] !== undefined) row[k] = l[k];
                               return row;
                             }
                             return { ...l, createdBy: req.user._id };
                           });

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

    /* Respect agent scoping; managers see all; referrers see only their expo */
    if (req.agentScope)         candidateFilter.assignedAgent = req.agentScope;
    else if (req.referrerExpoId) candidateFilter.expo          = req.referrerExpoId;

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
    await audit.record({
      action: 'record.merge',
      entityType: 'lead',
      entityId: target._id,
      summary: `Merged lead "${source.name}" into "${target.name}"`,
      meta: {
        sourceId: String(sourceId),
        targetId: String(target._id),
        /* The source row is destroyed by the merge; keep enough to answer
           "where did that lead go?" months later. */
        sourceSnapshot: {
          name: source.name, phone: source.phone, email: source.email,
          company: source.company, stage: source.stage, createdAt: source.createdAt,
        },
      },
    }, req);

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

/* ── POST /api/leads/bulk-scan ────────────────────────────────────
   PRD 3 Phase 1 — batch save of scan-reviewed leads (client-side OCR).
   Accepts up to 50 leads with ocrCapture, batch_id, batchName. */
async function bulkScan(req, res, next) {
  try {
    const { leads, batchName = '' } = req.body || {};
    if (!Array.isArray(leads) || leads.length === 0) return badRequest(res, 'leads array is required');
    if (leads.length > 50) return badRequest(res, 'Maximum 50 leads per batch');

    const batchId = 'batch_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);

    /* Dedup on phone within batch + against DB */
    const phones    = leads.map(l => (l.phone || '').replace(/\D/g,'').slice(-10)).filter(Boolean);
    const existing  = await Lead.find({ phone: { $regex: new RegExp(`(${phones.join('|')})$`) } }).select('phone').lean();
    const dupPhones = new Set(existing.map(l => l.phone.replace(/\D/g,'').slice(-10)));

    const agentId = req.agentScope || null;

    const toInsert = leads
      .filter(l => !dupPhones.has((l.phone || '').replace(/\D/g,'').slice(-10)))
      .map(l => {
        const row = {
          name:          l.name,
          phone:         l.phone,
          email:         l.email  || '',
          company:       l.company || '',
          notes:         l.notes  || '',
          source:        l.source || 'inbound_enquiry',
          stage:         'suspect',
          assignedAgent: agentId,
          ocrCapture:    l.ocrCapture || null,
          batch:         { batchId, batchName },
          createdBy:     req.user._id,
        };
        if (req.referrerExpoId) {
          row.expo          = req.referrerExpoId;
          row.source        = 'exhibition_event';
          row.assignedAgent = null;
        }
        return row;
      });

    let inserted = [];
    if (toInsert.length) inserted = await Lead.insertMany(toInsert);

    /* PRD 5 — trigger enrichment async for each inserted lead */
    for (const lead of inserted) queueEnrichment(lead._id, req.user._id);

    await Telemetry.create({
      eventName: 'bulk_scan_saved',
      userId: req.user._id,
      metadata: { batchId, batchName, inserted: inserted.length, duplicates: leads.length - toInsert.length },
    }).catch(() => {});

    return ok(res, {
      batchId,
      inserted:   inserted.length,
      duplicates: leads.length - toInsert.length,
      total:      leads.length,
    }, `Batch saved: ${inserted.length} leads`);
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/leads/:id/enrich ──────────────────────────────────
   PRD 5 AC1 — trigger enrichment on-demand (async, non-blocking). */
async function triggerEnrich(req, res, next) {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return notFound(res, 'Lead not found');
    if (req.agentScope && String(lead.assignedAgent) !== String(req.agentScope)) return forbidden(res, 'Access denied');
    if (req.referrerExpoId && String(lead.expo) !== String(req.referrerExpoId)) return forbidden(res, 'Access denied');

    /* Fire async; respond immediately (AC1: rep never blocked) */
    setImmediate(() => enrichLead(lead._id, req.user._id).catch(() => {}));
    return ok(res, { queued: true }, 'Enrichment queued');
  } catch (err) {
    next(err);
  }
}

/* ── DELETE /api/leads/:id/enrich/:field ─────────────────────────
   PRD 5 AC5 — roll back one enriched field + flag do_not_enrich. */
async function rollbackEnrichField(req, res, next) {
  try {
    const { field } = req.params;
    if (!ENRICHABLE.includes(field)) return badRequest(res, `Unknown enrichable field: ${field}`);

    const lead = await Lead.findById(req.params.id);
    if (!lead) return notFound(res, 'Lead not found');
    if (req.agentScope && String(lead.assignedAgent) !== String(req.agentScope)) return forbidden(res, 'Access denied');

    lead[field] = '';
    if (lead.enrichment) lead.enrichment.delete(field);
    if (!lead.doNotEnrich.includes(field)) lead.doNotEnrich.push(field);

    await lead.save();

    await Telemetry.create({
      eventName: 'enrichment_field_overridden',
      userId: req.user._id,
      leadId: lead._id,
      metadata: { field },
    }).catch(() => {});

    return ok(res, { field, rolledBack: true }, 'Field cleared and flagged do-not-enrich');
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/leads/batch/:batchId ───────────────────────────────
   PRD 3 AC3 — per-card status for a batch. */
async function getBatch(req, res, next) {
  try {
    const { batchId } = req.params;
    const filter = { 'batch.batchId': batchId };
    if (req.agentScope)         filter.assignedAgent = req.agentScope;
    else if (req.referrerExpoId) filter.expo          = req.referrerExpoId;

    const leads = await Lead.find(filter)
      .select('name phone email company stage ocrCapture batch enrichment createdAt')
      .lean();
    return ok(res, { batchId, count: leads.length, leads });
  } catch (err) {
    next(err);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   B1c — the stage transition contract
   docs/requirements/03-stage-gates.md
   ══════════════════════════════════════════════════════════════════════════ */

/** Agents may only touch their own book; everyone else is already permission-gated. */
function denyIfOutOfScope(req, lead) {
  if (req.agentScope && String(lead.assignedAgent) !== String(req.agentScope)) return true;
  if (req.referrerExpoId && String(lead.expo) !== String(req.referrerExpoId)) return true;
  return false;
}

/* ── POST /api/leads/:id/advance ─────────────────────────────────────── */

async function advanceLead(req, res, next) {
  try {
    const { toStage, note = '', patch, force = false, gateOverrideNote = '' } = req.body || {};
    if (!toStage) return badRequest(res, 'toStage is required');

    const lead = await Lead.findById(req.params.id);
    if (!lead) return notFound(res, 'Lead not found');
    if (denyIfOutOfScope(req, lead)) return forbidden(res, 'Access denied');

    /* An override is a privilege, not a flag anyone can set. A caller without
       lead.gate_override is treated as if they had not asked. */
    const mayOverride = can(req.user, 'lead.gate_override');
    const wantsOverride = force === true || force === 'true';
    if (wantsOverride && !mayOverride) {
      return forbidden(res, 'You are not permitted to override a stage gate');
    }
    if (wantsOverride && !String(gateOverrideNote).trim()) {
      return badRequest(res, 'gateOverrideNote is required when forcing a transition');
    }

    const result = applyTransition(lead, pipeline.SALES_STAGES, {
      toStage,
      patch,
      note,
      force: wantsOverride && mayOverride,
      gateOverrideNote,
      actor: req.user,
    });

    if (!result.ok) {
      /* Nothing was saved — the in-memory merge above is discarded with `lead`. */
      return gateFailed(res, result.code, result.message, result.missing);
    }

    await lead.save();

    await audit.stageTransition({
      entityType: 'lead',
      entityId: lead._id,
      from: result.from,
      to: result.to,
      direction: result.direction,
      note,
      label: lead.name,
    }, req);

    if (result.gateOverride) {
      await audit.gateOverride({
        entityType: 'lead',
        entityId: lead._id,
        from: result.from,
        to: result.to,
        missing: result.missing.map((m) => m.code),
        note: gateOverrideNote,
        label: lead.name,
      }, req);
    }

    /* Handoff 1 (S-9): a verified PO becomes a Delivery Work Order. Fired
       AFTER the lead is saved — the sale is already true; a handoff failure
       is logged and repaired by the nightly sweep, never surfaced as a
       failure of the transition that caused it. */
    let workOrder = null;
    if (result.to === 'commercial_order') {
      const { createWorkOrderForLead } = require('../services/handoffService');
      const populated_ = await Lead.findById(lead._id).populate('products', 'name sku price');
      workOrder = await createWorkOrderForLead(populated_, req);
    }

    const populated = await Lead.findById(lead._id)
      .populate('assignedAgent', 'name initials color')
      .populate('products', 'name sku price')
      .lean({ virtuals: true });

    return ok(res, {
      lead: populated,
      transition: {
        from: result.from, to: result.to, direction: result.direction,
        gateOverride: result.gateOverride,
        waived: result.missing.map((m) => m.code),
      },
      ...(workOrder && {
        workOrder: { _id: workOrder._id, woNumber: workOrder.woNumber, stage: workOrder.stage },
      }),
    }, `Moved to ${pipeline.stageLabel(pipeline.SALES_STAGES, result.to)}`);
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/leads/:id/gate?to= ─────────────────────────────────────── */

async function previewLeadGate(req, res, next) {
  try {
    const lead = await Lead.findById(req.params.id).lean({ virtuals: true });
    if (!lead) return notFound(res, 'Lead not found');
    if (denyIfOutOfScope(req, lead)) return forbidden(res, 'Access denied');

    /* Default to the next stage forward, which is what the UI asks for 95% of
       the time when it renders "what is blocking this deal?". */
    const toStage = req.query.to || pipeline.nextStage(pipeline.SALES_STAGES, lead.stage);
    if (!toStage) {
      return ok(res, {
        from: lead.stage, to: null, allowed: false,
        message: `${pipeline.stageLabel(pipeline.SALES_STAGES, lead.stage)} is a closed stage`,
        requirements: [],
      });
    }

    const preview = previewGate(lead, pipeline.SALES_STAGES, toStage);
    return ok(res, { from: lead.stage, to: toStage, ...preview });
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/leads/hygiene ──────────────────────────────────────────── */

async function hygieneQueue(req, res, next) {
  try {
    const filter = { needsReview: true };
    if (req.agentScope) filter.assignedAgent = req.agentScope;
    if (req.referrerExpoId) filter.expo = req.referrerExpoId;
    if (req.query.code) filter.reviewIssues = req.query.code;

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 50 });

    const [leads, total, byCode] = await Promise.all([
      Lead.find(filter)
        .select('name phone company stage stageEnteredAt assignedAgent reviewIssues '
              + 'needsReview expectedCloseDate nextFollowUpDate value')
        .populate('assignedAgent', 'name initials color')
        .sort({ stageEnteredAt: 1 })
        .skip(skip).limit(limit)
        .lean(),
      Lead.countDocuments(filter),
      /* The worklist is only actionable if a manager can see WHICH rule is
         failing across the book, not just how many records are flagged. */
      Lead.aggregate([
        { $match: filter },
        { $unwind: '$reviewIssues' },
        { $group: { _id: '$reviewIssues', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    return paginated(res, { leads, byCode }, total, page, limit);
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/leads/:id/upload ───────────────────────────────────────────
   The counterpart to stripping `attachments` from the write payloads. Without
   this the S-8 PO gate is unsatisfiable through the API at all: the gate wants
   a `po` document and nothing could put one on the lead. */

async function uploadAttachment(req, res, next) {
  try {
    const { docType } = req.body || {};
    if (!pipeline.DOC_TYPE_KEYS.includes(docType)) {
      return unprocessable(res, `docType must be one of: ${pipeline.DOC_TYPE_KEYS.join(', ')}`);
    }
    if (!req.file) return badRequest(res, 'Attach a file under the field name "file"');

    const lead = await Lead.findById(req.params.id);
    if (!lead) return notFound(res, 'Lead not found');

    /* Same scoping the rest of the controller applies — an agent may only
       attach to a lead assigned to them. */
    if (req.agentScope && String(lead.assignedAgent) !== String(req.agentScope)) {
      return forbidden(res, 'Access denied');
    }

    const stored = await fileStore.put(req.file.buffer, {
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      docType,
      uploadedBy: req.user._id,
    });

    lead.attachments.push({ ...stored, docType, uploadedBy: req.user._id });
    await lead.save();

    /* `record.update` rather than a new action: a document arriving on a lead
       is an update to that record, and the gate-relevant detail is the
       docType, which `meta` carries. */
    await audit.record({
      action: 'record.update', entityType: 'lead', entityId: lead._id,
      summary: `${docType} attached to lead ${lead.name}`,
      meta: { docType, filename: req.file.originalname },
    }, req);

    return created(res, lead.attachments.at(-1), `${docType} attached`);
  } catch (err) {
    if (err instanceof fileStore.FileStoreError) return unprocessable(res, err.message);
    next(err);
  }
}

module.exports = {
  listLeads, getLead, createLead, updateLead, deleteLead, addFollowUp, bulkImport,
  checkDuplicate, mergeLead, logTelemetry,
  bulkScan, triggerEnrich, rollbackEnrichField, getBatch,
  advanceLead, previewLeadGate, hygieneQueue,
  uploadAttachment, uploadMiddleware: upload.single('file'),
};
