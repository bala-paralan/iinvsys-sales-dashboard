'use strict';
const { SALES_STAGE_KEYS, LEAD_SOURCE_KEYS } = require('../config/pipeline');
const Setting = require('../models/Setting');
const { ok, notFound, unprocessable } = require('../utils/response');
const runtime = require('../config/pipelineRuntime');
const pipeline = require('../config/pipeline');
const audit = require('../services/auditService');

/* Default settings to seed on first load */
const DEFAULTS = [
  { key: 'company.name',      value: 'IINVSYS',          label: 'Company Name',       type: 'string',  group: 'branding' },
  { key: 'company.tagline',   value: 'Sales OS v1.0',    label: 'Tagline',            type: 'string',  group: 'branding' },
  { key: 'company.currency',  value: '₹',                label: 'Currency Symbol',    type: 'string',  group: 'branding' },
  { key: 'lead.stages',       value: SALES_STAGE_KEYS,
                                                          label: 'Lead Stages',        type: 'array',   group: 'pipeline' },
  { key: 'lead.sources',      value: LEAD_SOURCE_KEYS,
                                                          label: 'Lead Sources',       type: 'array',   group: 'pipeline' },
  { key: 'lead.overdueAfterDays', value: 7,              label: 'Overdue After (days)',type: 'number',  group: 'pipeline' },
  { key: 'product.categories',value: ['hardware','software','service','bundle'],
                                                          label: 'Product Categories', type: 'array',   group: 'products' },
  { key: 'agent.defaultTarget', value: 500000,           label: 'Default Monthly Target (₹)', type: 'number', group: 'agents' },
  { key: 'expo.defaultTargetLeads', value: 100,          label: 'Default Expo Target Leads', type: 'number', group: 'expos' },
  { key: 'system.allowSelfRegister', value: false,       label: 'Allow Self Registration', type: 'boolean', group: 'system' },
  { key: 'system.maintenanceMode',   value: false,       label: 'Maintenance Mode',   type: 'boolean', group: 'system' },
];

/* ── GET /api/settings ─────────────────────────────────────────── */
async function listSettings(req, res, next) {
  try {
    let settings = await Setting.find({}).sort({ group: 1, key: 1 }).lean();

    /* Seed defaults if nothing exists yet */
    if (settings.length === 0) {
      await Setting.insertMany(DEFAULTS);
      settings = await Setting.find({}).sort({ group: 1, key: 1 }).lean();
    }

    /* Return as a flat map for easy consumption */
    const map = {};
    settings.forEach(s => { map[s.key] = s.value; });
    return ok(res, { settings, map });
  } catch (err) {
    next(err);
  }
}

/* ── PUT /api/settings ─────────────────────────────────────────── */
/* Body: { updates: { "lead.stages": [...], "company.name": "..." } } */
async function updateSettings(req, res, next) {
  try {
    const { updates } = req.body;
    if (!updates || typeof updates !== 'object') {
      return unprocessable(res, 'Validation failed', [{ msg: 'updates object is required' }]);
    }

    /* Pipeline rules go through PUT /api/settings/pipeline, which validates
       against the SPEC before writing. Allowing them here meant a superadmin
       could save `spenco.minTotal: "eighteen"` — accepted silently, then
       rejected by the STRICT loader at the next production boot, so the app
       refused to start and the cause was a settings edit made days earlier. */
    const ruleKeys = Object.keys(updates).filter((k) => k.startsWith(runtime.PREFIX));
    if (ruleKeys.length) {
      return unprocessable(res, 'Pipeline rules are edited through PUT /api/settings/pipeline',
        ruleKeys.map((k) => ({ msg: `${k} must be set via the pipeline endpoint` })));
    }

    const ops = Object.entries(updates).map(([key, value]) => ({
      updateOne: {
        filter: { key },
        update: { $set: { value, updatedBy: req.user._id } },
        upsert: true,
      },
    }));

    await Setting.bulkWrite(ops);
    const settings = await Setting.find({}).sort({ group: 1, key: 1 }).lean();
    const map = {};
    settings.forEach(s => { map[s.key] = s.value; });
    return ok(res, { settings, map }, 'Settings updated');
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/settings/:key ────────────────────────────────────── */
async function getSetting(req, res, next) {
  try {
    const s = await Setting.findOne({ key: req.params.key }).lean();
    if (!s) return notFound(res, `Setting '${req.params.key}' not found`);
    return ok(res, s);
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/settings/pipeline ────────────────────────────────
   The R-2 rule editor's data: the spec, the current value and the compiled-in
   default for each of the 10 configurable rules, so the UI can render an
   editor and a "reset to default" without knowing any rule by name. */
async function getPipelineRules(req, res, next) {
  try {
    const docs = await Setting.find({ key: { $in: runtime.RULE_SETTING_KEYS } }).lean();
    const byKey = new Map(docs.map((d) => [d.key, d]));
    const active = pipeline.getActiveRules();

    return ok(res, {
      version: pipeline.pipelineVersion(),
      rules: runtime.seedDefinitions().map((def) => {
        const doc = byKey.get(def.key);
        const spec = runtime.SPEC[def.key];
        return {
          key: def.key,
          rule: spec.rule,
          label: def.label || def.key,
          description: def.description || '',
          value: doc ? doc.value : def.value,
          default: def.value,
          active: active[spec.rule],
          /* Whether the persisted value still differs from the default is the
             one thing a reviewer of this screen actually wants to see. */
          overridden: doc ? JSON.stringify(doc.value) !== JSON.stringify(def.value) : false,
          updatedAt: doc ? doc.updatedAt : null,
        };
      }),
    });
  } catch (err) { next(err); }
}

/* ── PUT /api/settings/pipeline ────────────────────────────────
   Validate → persist → RE-INSTALL. The re-install is the part that matters:
   without it a threshold change sat in the database until the next restart,
   while the UI reported it as saved and the gates kept using the old value. */
async function updatePipelineRules(req, res, next) {
  try {
    const { updates } = req.body || {};
    if (!updates || typeof updates !== 'object' || !Object.keys(updates).length) {
      return unprocessable(res, 'Validation failed', [{ msg: 'updates object is required' }]);
    }

    const unknown = Object.keys(updates).filter((k) => !runtime.SPEC[k]);
    if (unknown.length) {
      return unprocessable(res, 'Unknown pipeline rule(s)',
        unknown.map((k) => ({ msg: `${k} is not a configurable rule` })));
    }

    /* Validate EVERY key before writing ANY of them — a half-applied rule set
       is a pipeline nobody configured. */
    const errors = [];
    const coerced = {};
    for (const [key, raw] of Object.entries(updates)) {
      const spec = runtime.SPEC[key];
      try {
        const value = spec.coerce(raw);
        spec.validate(value);
        coerced[key] = value;
      } catch (err) {
        errors.push({ msg: `${key}: ${err.message}` });
      }
    }
    if (errors.length) return unprocessable(res, 'Invalid pipeline rule value(s)', errors);

    const before = pipeline.getActiveRules();

    await Setting.bulkWrite(Object.entries(coerced).map(([key, value]) => ({
      updateOne: {
        filter: { key },
        update: { $set: { value, updatedBy: req.user._id } },
        upsert: true,
      },
    })));

    /* Strict: the values were just validated, so a failure here is a bug in
       this handler, not bad input, and must not be swallowed. */
    const { rules } = await runtime.loadRules({ strict: true });

    for (const [key, value] of Object.entries(coerced)) {
      await audit.record({
        action: 'settings.rule_change', entityType: 'setting',
        summary: `${key} set to ${JSON.stringify(value)}`,
        meta: { key, value, previous: before[runtime.SPEC[key].rule] },
      }, req);
    }

    return ok(res, {
      /* The version hash folds in the resolved rules, so returning it lets the
         client drop its cached gate checklists immediately. */
      version: pipeline.pipelineVersion(),
      changed: Object.keys(coerced),
      rules,
    }, 'Pipeline rules updated');
  } catch (err) { next(err); }
}

module.exports = {
  listSettings, updateSettings, getSetting,
  getPipelineRules, updatePipelineRules,
};
