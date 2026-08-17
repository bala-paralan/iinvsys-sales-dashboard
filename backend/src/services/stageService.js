'use strict';
/**
 * stageService — the transition contract from docs/requirements/03-stage-gates.md.
 *
 *   POST /api/leads/:id/advance  { toStage, note, patch, force?, gateOverrideNote? }
 *        │
 *        ├── 1. canAdvance(from, to)?          → 422 STAGE_SKIP / TERMINAL_STAGE
 *        ├── 2. merge `patch` into the record  (IN MEMORY ONLY)
 *        ├── 3. validateStageEntry(record, to) → 422 STAGE_GATE_FAILED { missing }
 *        └── 4. save + append a stageHistory entry
 *
 * ── The all-or-nothing property ─────────────────────────────────────────
 * Step 2 mutates a Mongoose document that is never saved unless step 3 passes.
 * That is what makes "fill in the three missing fields and advance" a single
 * request rather than a half-applied write: a rejected advance leaves the
 * database exactly as it was, so a rep who gets a 422 has not silently had
 * three of their five edits persisted.
 *
 * Written generically over a stage list so WorkOrder (B2) and InstallationJob
 * (B3) get the same contract rather than three divergent copies of it.
 */
const pipeline = require('../config/pipeline');

/** Fields a caller may never set through `patch` — they are derived or audited. */
const PROTECTED_PATCH_FIELDS = new Set([
  '_id', 'stage', 'stageHistory', 'stageEnteredAt',
  'needsReview', 'reviewIssues', 'createdBy', 'createdAt', 'updatedAt',
  'attachments', // uploads go through the upload endpoint, which validates bytes
]);

/**
 * Strip anything a caller must not set. `spenco.qualified` and `spenco.total`
 * are allowed through here because the model's pre('validate') hook recomputes
 * them from the dimensions — a forged value cannot survive the write.
 */
function sanitizePatch(patch) {
  const clean = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (PROTECTED_PATCH_FIELDS.has(k)) continue;
    clean[k] = v;
  }
  return clean;
}

/**
 * Attempt a stage transition.
 *
 * Does NOT save on failure. Returns a discriminated result rather than throwing,
 * because every failure mode here is a 422 the client must render, not an
 * exception.
 *
 * @param {object}   doc        a Mongoose document carrying `stage`
 * @param {Array}    stages     pipeline.SALES_STAGES | DELIVERY_STAGES | INSTALL_STAGES
 * @param {object}   opts
 * @param {string}   opts.toStage
 * @param {object}   [opts.patch]
 * @param {string}   [opts.note]
 * @param {boolean}  [opts.force]             caller already checked the permission
 * @param {string}   [opts.gateOverrideNote]
 * @param {object}   [opts.actor]             { _id, name }
 * @param {object}   [opts.rules]             explicit rule set, for tests
 * @returns {{ok:true, from, to, direction, gateOverride, missing}
 *          |{ok:false, code, message, missing}}
 */
function applyTransition(doc, stages, opts = {}) {
  const { toStage, patch, note = '', force = false, gateOverrideNote = '', actor, rules } = opts;
  const from = doc.stage;

  /* 1 — is this move legal at all? */
  const move = pipeline.canAdvance(stages, from, toStage);
  if (!move.ok) {
    return { ok: false, code: move.reason, message: move.message, missing: [] };
  }

  /* 2 — merge the patch in memory. Never persisted unless step 3 passes. */
  if (patch) Object.assign(doc, sanitizePatch(patch));

  /* Re-derive anything the gate reads BEFORE evaluating it.
   *
   * The model recomputes spenco.total/qualified in pre('validate'), but that
   * runs on save() — which is step 4, AFTER the gate. Without this line a
   * caller could post `patch: { spenco: { qualified: true } }`, satisfy the
   * Engagement gate with a value they invented, and advance; the hook would
   * then quietly correct the field on write, leaving a lead sitting in
   * Engagement that never qualified. Derive first, then judge. */
  if (doc.spenco) {
    doc.spenco.total     = pipeline.spencoTotal(doc.spenco, rules);
    doc.spenco.qualified = pipeline.spencoQualified(doc.spenco, rules);
    if (!doc.spenco.scoredAt && pipeline.spencoScored(doc.spenco)) {
      doc.spenco.scoredAt = new Date();
    }
  }

  /* 3 — the gate. Backward moves and re-openings are ungated by design: a deal
     being pulled back is a correction, and demanding the target stage's
     paperwork to undo a mistake would just encourage leaving it wrong. */
  let missing = [];
  if (move.gated) {
    const verdict = pipeline.validateStageEntry(doc, stages, toStage, new Date(), rules);
    if (!verdict.ok) {
      missing = verdict.missing;
      if (!force || !String(gateOverrideNote).trim()) {
        return {
          ok: false,
          code: 'STAGE_GATE_FAILED',
          message: `Cannot advance to ${pipeline.stageLabel(stages, toStage)} — `
            + `${missing.length} requirement(s) not met`,
          missing,
        };
      }
    }
  }

  /* 4 — apply. */
  const now = new Date();
  const enteredAt = doc.stageEnteredAt ? new Date(doc.stageEnteredAt) : null;
  const durationDays = enteredAt ? Math.max(0, (now - enteredAt) / 86400000) : null;

  const target = pipeline.stageDef(stages, toStage);
  doc.stage = toStage;
  doc.stageEnteredAt = now;

  /* The stage default probability applies unless someone deliberately set a
     different one — the hygiene rule (C-2) polices how far it may deviate. */
  if (target && typeof target.probability === 'number') {
    doc.probability = target.probability;
  }

  const gateOverride = missing.length > 0;
  if (Array.isArray(doc.stageHistory)) {
    doc.stageHistory.push({
      from: from || null,
      to: toStage,
      at: now,
      by: actor ? actor._id : null,
      byName: actor ? actor.name : '',
      direction: move.direction,
      note,
      durationDays: durationDays === null ? null : Math.round(durationDays * 100) / 100,
      gateOverride,
      /* The exact list waived, so an override is auditable after the fact and
         not merely flagged. */
      missingAtOverride: gateOverride ? missing.map((m) => m.code) : [],
    });
  }

  return { ok: true, from, to: toStage, direction: move.direction, gateOverride, missing };
}

/** Preflight a gate without mutating anything — powers the UI checklist. */
function previewGate(doc, stages, toStage, rules) {
  const move = pipeline.canAdvance(stages, doc.stage, toStage);
  if (!move.ok) {
    return { allowed: false, code: move.reason, message: move.message, requirements: [] };
  }

  const target = pipeline.stageDef(stages, toStage);
  const reqs = (target && target.entryRequires) || [];
  const resolved = pipeline.resolveStages(stages, rules);
  const resolvedTarget = pipeline.stageDef(resolved, toStage);

  const requirements = ((resolvedTarget && resolvedTarget.entryRequires) || reqs).map((r) => ({
    field: r.field,
    test: r.test,
    message: r.message,
    code: `${r.field}.${String(r.test).split(':')[0]}`,
    met: pipeline.evaluateTest(doc, r, new Date(), rules),
  }));

  return {
    allowed: true,
    gated: move.gated,
    direction: move.direction,
    ok: requirements.every((r) => r.met),
    requirements,
  };
}

module.exports = { applyTransition, previewGate, sanitizePatch, PROTECTED_PATCH_FIELDS };
