'use strict';
/**
 * pipelineRuntime — R-2.
 *
 * Resolves the configurable pipeline rules from the Setting collection over the
 * compiled-in defaults in `pipeline.js`, and installs the result for the
 * lifetime of the process.
 *
 * Why these live in Settings rather than in code
 * ----------------------------------------------
 * The two source documents leave several rules genuinely undecided — most
 * importantly the SPENCO qualification threshold (assumption A18), which
 * directly determines the Suspect-to-Prospect conversion rate reported against
 * its 40% target. Hard-coding a guess means a code change *and* a data
 * migration when the Sales Director eventually rules. As a Setting it is an
 * afternoon's decision with no deploy.
 *
 * See docs/requirements/09-configurable-rules.md and
 * docs/requirements/07-open-questions-and-assumptions.md.
 */
const Setting  = require('../models/Setting');
const pipeline = require('./pipeline');

const PREFIX = 'pipeline.';

/**
 * Setting key → { rule, coerce, validate }.
 *
 * `validate` throws a human-readable message. A bad Setting must fail loudly at
 * boot rather than silently reverting to a default — a threshold that quietly
 * snaps back to 18 while the Settings page shows 24 is the worst outcome here.
 */
const SPEC = {
  'pipeline.spenco.minTotal': {
    rule: 'spencoMinTotal',
    coerce: Number,
    validate: (v) => {
      if (!Number.isInteger(v) || v < 0 || v > pipeline.SPENCO_MAX_TOTAL) {
        throw new Error(`must be an integer between 0 and ${pipeline.SPENCO_MAX_TOTAL}`);
      }
    },
  },

  'pipeline.spenco.subGates': {
    rule: 'spencoSubGates',
    coerce: (v) => (typeof v === 'string' ? JSON.parse(v) : v),
    validate: (v) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('must be an object');
      const dims = pipeline.SPENCO_DIMENSIONS.map((d) => d.key);
      for (const [dim, min] of Object.entries(v)) {
        if (!dims.includes(dim)) throw new Error(`unknown SPENCO dimension '${dim}'`);
        if (!Number.isInteger(min) || min < 0 || min > pipeline.SPENCO_MAX_PER_DIMENSION) {
          throw new Error(`'${dim}' must be an integer between 0 and ${pipeline.SPENCO_MAX_PER_DIMENSION}`);
        }
      }
    },
  },

  'pipeline.amcRequiredCompanyTypes': {
    rule: 'amcRequiredCompanyTypes',
    coerce: (v) => (typeof v === 'string' ? JSON.parse(v) : v),
    validate: (v) => {
      if (!Array.isArray(v)) throw new Error('must be an array of company type keys');
      const valid = pipeline.COMPANY_TYPE_KEYS;
      const bad = v.filter((k) => !valid.includes(k));
      if (bad.length) throw new Error(`unknown company type(s): ${bad.join(', ')}`);
    },
  },

  'pipeline.competitorRequiredFromStage': {
    rule: 'competitorRequiredFromStage',
    coerce: String,
    validate: (v) => {
      const open = pipeline.OPEN_SALES_STAGES;
      if (!open.includes(v)) throw new Error(`must be one of: ${open.join(', ')}`);
    },
  },

  'pipeline.probabilityOverrideMaxPoints': {
    rule: 'probabilityOverrideMaxPoints',
    coerce: Number,
    validate: (v) => {
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error('must be between 0 and 100');
    },
  },

  'pipeline.delayClockResetsOnRevision': {
    rule: 'delayClockResetsOnRevision',
    coerce: (v) => v === true || v === 'true',
    validate: () => {},
  },

  'pipeline.stateToZone': {
    rule: 'stateToZone',
    coerce: (v) => (typeof v === 'string' ? JSON.parse(v) : v),
    validate: (v) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('must be an object');
      const zones = pipeline.ZONE_KEYS;
      const bad = [...new Set(Object.values(v))].filter((z) => !zones.includes(z));
      if (bad.length) throw new Error(`unknown zone(s): ${bad.join(', ')}`);
    },
  },

  'pipeline.inactivityAlertDays': {
    rule: 'inactivityAlertDays',
    coerce: Number,
    validate: (v) => { if (!Number.isInteger(v) || v < 1) throw new Error('must be a positive integer'); },
  },

  'pipeline.followUpMaxDaysAhead': {
    rule: 'followUpMaxDaysAhead',
    coerce: Number,
    validate: (v) => { if (!Number.isInteger(v) || v < 1) throw new Error('must be a positive integer'); },
  },

  'pipeline.weeklyNoteDays': {
    rule: 'weeklyNoteDays',
    coerce: Number,
    validate: (v) => { if (!Number.isInteger(v) || v < 1) throw new Error('must be a positive integer'); },
  },
};

/** Setting keys this module owns. Used by the Settings route to scope writes. */
const RULE_SETTING_KEYS = Object.keys(SPEC);

/**
 * Turn raw Setting documents into a rules override object.
 * Pure — no database access — so it is directly testable.
 *
 * @param {Array<{key,value}>} docs
 * @returns {{overrides: object, errors: Array<{key, message}>}}
 */
function resolveOverrides(docs) {
  const overrides = {};
  const errors = [];

  for (const doc of docs || []) {
    const spec = SPEC[doc.key];
    if (!spec) continue; // not a rule setting

    try {
      const value = spec.coerce(doc.value);
      spec.validate(value);
      overrides[spec.rule] = value;
    } catch (err) {
      errors.push({ key: doc.key, message: err.message });
    }
  }

  return { overrides, errors };
}

/**
 * Read the Setting collection and install the resolved rules.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.strict] throw when a stored setting is invalid.
 *        Defaults to true in production — booting with a silently-ignored
 *        threshold is worse than not booting.
 * @returns {Promise<{rules: object, errors: Array}>}
 */
async function loadRules(opts = {}) {
  const strict = opts.strict ?? (process.env.NODE_ENV === 'production');

  let docs = [];
  try {
    docs = await Setting.find({ key: { $regex: `^${PREFIX.replace('.', '\\.')}` } }).lean();
  } catch (err) {
    if (strict) throw err;
    console.warn(`⚠️  pipelineRuntime: could not read Settings (${err.message}). Using defaults.`);
    return { rules: pipeline.setActiveRules({}), errors: [] };
  }

  const { overrides, errors } = resolveOverrides(docs);

  if (errors.length) {
    const detail = errors.map((e) => `  ${e.key}: ${e.message}`).join('\n');
    if (strict) {
      throw new Error(`Invalid pipeline rule setting(s):\n${detail}`);
    }
    console.warn(`⚠️  Ignoring invalid pipeline rule setting(s):\n${detail}`);
  }

  const rules = pipeline.setActiveRules(overrides);

  /* Report only what genuinely DIFFERS from the default. seedRuleSettings()
     writes a row for every rule, so "read from Settings" is true of all ten and
     tells an operator nothing. What they need on a boot line is the short list
     of places this deployment departs from the documented default. */
  const changed = Object.keys(overrides).filter(
    (rule) => JSON.stringify(overrides[rule]) !== JSON.stringify(pipeline.DEFAULT_RULES[rule])
  );
  if (changed.length) {
    console.log('⚙️   Pipeline rules differing from defaults:');
    for (const rule of changed) {
      console.log(`      ${rule}: ${JSON.stringify(pipeline.DEFAULT_RULES[rule])} → ${JSON.stringify(overrides[rule])}`);
    }
  }

  return { rules, errors, changed };
}

/** Reset to the compiled-in defaults. Used by tests and by a settings rollback. */
function resetRules() {
  return pipeline.setActiveRules({});
}

/**
 * The seed rows written on first boot, so the Settings page shows every rule
 * with its current value rather than an empty list.
 */
function seedDefinitions() {
  const d = pipeline.DEFAULT_RULES;
  return [
    { key: 'pipeline.spenco.minTotal', value: d.spencoMinTotal, type: 'number', group: 'pipeline',
      label: 'SPENCO minimum total',
      description: `Out of ${pipeline.SPENCO_MAX_TOTAL}. Gates Prospect → Engagement and drives the Suspect-to-Prospect KPI (assumption A18).` },
    { key: 'pipeline.spenco.subGates', value: d.spencoSubGates, type: 'object', group: 'pipeline',
      label: 'SPENCO per-dimension minimums',
      description: 'Hard floors that apply in addition to the total (assumption A18).' },
    { key: 'pipeline.amcRequiredCompanyTypes', value: d.amcRequiredCompanyTypes, type: 'array', group: 'pipeline',
      label: 'Company types requiring AMC',
      description: 'The working definition of "industrial" for the AMC rule at Commercial Order (assumption A4).' },
    { key: 'pipeline.competitorRequiredFromStage', value: d.competitorRequiredFromStage, type: 'string', group: 'pipeline',
      label: 'Competitor mandatory from stage',
      description: 'The dictionary says "Qualified stage or later", but no stage is named Qualified (assumption A2).' },
    { key: 'pipeline.probabilityOverrideMaxPoints', value: d.probabilityOverrideMaxPoints, type: 'number', group: 'pipeline',
      label: 'Probability override tolerance (points)',
      description: 'Percentage points above the stage default allowed without a note (assumption A5).' },
    { key: 'pipeline.delayClockResetsOnRevision', value: d.delayClockResetsOnRevision, type: 'boolean', group: 'pipeline',
      label: 'Delay clock resets on re-revision',
      description: 'When false, the 48-hour notice is always measured against the ORIGINAL committed date (assumption A12).' },
    { key: 'pipeline.stateToZone', value: d.stateToZone, type: 'object', group: 'pipeline',
      label: 'State → Zone mapping',
      description: 'India has no canonical four-zone split; MP and Chhattisgarh are the debatable placements (assumption A17).' },
    { key: 'pipeline.inactivityAlertDays', value: d.inactivityAlertDays, type: 'number', group: 'pipeline',
      label: 'Inactivity alert (days)',
      description: 'Days without activity before a lead is flagged to the Sales Manager.' },
    { key: 'pipeline.followUpMaxDaysAhead', value: d.followUpMaxDaysAhead, type: 'number', group: 'pipeline',
      label: 'Follow-up horizon (days)',
      description: 'Beyond this, a follow-up date needs a recorded reason. Flag only, never a gate (assumption A8).' },
    { key: 'pipeline.weeklyNoteDays', value: d.weeklyNoteDays, type: 'number', group: 'pipeline',
      label: 'Note staleness (days)',
      description: 'Deals at Engagement and above need a note this often (assumption A9).' },
  ];
}

/** Insert any missing rule Settings. Never overwrites an operator's value. */
async function seedRuleSettings() {
  const defs = seedDefinitions();
  const existing = new Set(
    (await Setting.find({ key: { $in: defs.map((d) => d.key) } }).select('key').lean())
      .map((d) => d.key)
  );
  const missing = defs.filter((d) => !existing.has(d.key));
  if (missing.length) await Setting.insertMany(missing);
  return missing.map((d) => d.key);
}

module.exports = {
  SPEC, RULE_SETTING_KEYS, PREFIX,
  resolveOverrides, loadRules, resetRules,
  seedDefinitions, seedRuleSettings,
};
