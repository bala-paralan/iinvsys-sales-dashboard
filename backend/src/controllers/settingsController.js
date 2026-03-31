'use strict';
const Setting = require('../models/Setting');
const { ok, notFound, unprocessable } = require('../utils/response');

/* Default settings to seed on first load */
const DEFAULTS = [
  { key: 'company.name',      value: 'IINVSYS',          label: 'Company Name',       type: 'string',  group: 'branding' },
  { key: 'company.tagline',   value: 'Sales OS v1.0',    label: 'Tagline',            type: 'string',  group: 'branding' },
  { key: 'company.currency',  value: '₹',                label: 'Currency Symbol',    type: 'string',  group: 'branding' },
  { key: 'lead.stages',       value: ['new','contacted','interested','proposal','negotiation','won','lost'],
                                                          label: 'Lead Stages',        type: 'array',   group: 'pipeline' },
  { key: 'lead.sources',      value: ['expo','referral','direct','digital'],
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

module.exports = { listSettings, updateSettings, getSetting };
