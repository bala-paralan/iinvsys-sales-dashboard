'use strict';
/**
 * auditService — the only sanctioned way to write an AuditLog entry.
 *
 * ── The failure decision, stated once ────────────────────────────────────
 * `record()` NEVER throws into its caller. If the audit write fails, the
 * business operation still succeeds and the failure is logged loudly to stderr.
 *
 * That is a real trade-off, so it is worth being explicit: the alternative —
 * failing the operation when it cannot be logged — is correct for a system
 * where the audit trail is a regulatory artefact. Here it would mean a
 * customer's verified Purchase Order is rejected because a secondary write
 * failed, which loses more than it protects.
 *
 * `recordStrict()` exists for the cases where the reverse is true. Nothing uses
 * it yet; it is here so that when a caller does need write-or-fail semantics,
 * it does not get bolted on as a try/catch at the call site.
 */
const AuditLog = require('../models/AuditLog');

/** Pull actor + request fingerprint off an Express request, if there is one. */
function actorFrom(req) {
  const u = req && req.user;
  return {
    actor: {
      user: u ? u._id : null,
      name: u ? u.name : '',
      role: u ? u.role : '',
    },
    ip: (req && (req.ip || req.headers?.['x-forwarded-for'])) || '',
    userAgent: (req && req.headers?.['user-agent']) || '',
  };
}

function build(entry, req) {
  const { actor, ip, userAgent } = actorFrom(req);
  return {
    action:     entry.action,
    entityType: entry.entityType,
    entityId:   entry.entityId || null,
    summary:    entry.summary,
    meta:       entry.meta || {},
    at:         entry.at || new Date(),
    /* An explicit actor on the entry wins — a scheduled sweep has no request. */
    actor:      entry.actor || actor,
    ip:         entry.ip ?? ip,
    userAgent:  entry.userAgent ?? userAgent,
  };
}

/**
 * Write an audit entry. Resolves to the document, or to null if the write
 * failed — callers are not expected to check.
 */
async function record(entry, req) {
  try {
    return await AuditLog.create(build(entry, req));
  } catch (err) {
    console.error(
      `AUDIT WRITE FAILED [${entry && entry.action}] ${entry && entry.summary}: ${err.message}`
    );
    return null;
  }
}

/** As `record`, but propagates the error. For write-or-fail call sites. */
async function recordStrict(entry, req) {
  return AuditLog.create(build(entry, req));
}

/* ── Typed helpers ────────────────────────────────────────────────────────
   These exist so the `action` vocabulary and the `meta` shape are decided in
   one place. A caller writing `meta: {from, to}` by hand somewhere else is how
   a log stops being queryable. */

/** A stage move on any of the three process entities. */
function stageTransition({ entityType, entityId, from, to, direction, note, label }, req) {
  return record({
    action: 'stage.transition',
    entityType,
    entityId,
    summary: `${label || entityType} moved ${from || '(new)'} → ${to}`,
    meta: { from: from || null, to, direction: direction || 'forward', note: note || '' },
  }, req);
}

/**
 * A manager waiving a stage gate. `missing` is the exact list of requirements
 * that were unmet at the moment of the override — the framework's rule is that
 * an override is always visible and never silent, and that list is what makes
 * it visible afterwards.
 */
function gateOverride({ entityType, entityId, from, to, missing, note, label }, req) {
  return record({
    action: 'stage.gate_override',
    entityType,
    entityId,
    summary: `Gate override on ${label || entityType}: ${from || '(new)'} → ${to} — `
      + `${(missing || []).length} requirement(s) waived`,
    meta: {
      from: from || null,
      to,
      missingAtOverride: missing || [],
      note: note || '',
    },
  }, req);
}

/** A destructive operation. Snapshot enough to reconstruct what was lost. */
function destruction({ entityType, entityId, snapshot, reason, label }, req) {
  return record({
    action: 'record.delete',
    entityType,
    entityId,
    summary: `Deleted ${entityType}${label ? ` "${label}"` : ''}`,
    meta: { snapshot: snapshot || null, reason: reason || '' },
  }, req);
}

/** A configurable pipeline rule changing value (R-2). */
function ruleChange({ key, before, after }, req) {
  return record({
    action: 'settings.rule_change',
    entityType: 'setting',
    summary: `Pipeline rule "${key}" changed`,
    meta: { key, before, after },
  }, req);
}

/** A role change is the highest-leverage edit in the system. */
function roleChange({ userId, name, before, after }, req) {
  return record({
    action: 'user.role_change',
    entityType: 'user',
    entityId: userId,
    summary: `Role for "${name}" changed ${before} → ${after}`,
    meta: { before, after },
  }, req);
}

/** Successful and failed sign-ins. `email` only — never the attempted password. */
function login({ ok, email, userId, name, role, reason }, req) {
  return record({
    action: ok ? 'auth.login' : 'auth.login_failed',
    entityType: 'user',
    entityId: userId || null,
    summary: ok ? `${email} signed in` : `Failed sign-in for ${email}`,
    meta: ok ? {} : { reason: reason || 'invalid_credentials' },
    actor: ok
      ? { user: userId || null, name: name || '', role: role || '' }
      /* A failed sign-in has no authenticated actor — attributing it to the
         claimed account would assert an identity that was never proven. */
      : { user: null, name: '', role: '' },
  }, req);
}

module.exports = {
  record, recordStrict,
  stageTransition, gateOverride, destruction, ruleChange, roleChange, login,
};
