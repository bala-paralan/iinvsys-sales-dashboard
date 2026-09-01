'use strict';

const { FIELD_PERMISSIONS } = require('../config/fieldVisibility');
const { permissionsFor } = require('../config/permissions');

/**
 * redact(data, user) — strip fields the caller may not see, at any depth.
 *
 * Called from ok() / created() / paginated() in utils/response.js, which is the one
 * place every JSON response passes through and therefore the one place a newly added
 * endpoint cannot forget. Three backstops sit behind it, because a single chokepoint is
 * not enough: query-layer projections on the hot list endpoints, an explicit flag in
 * utils/excelReport.js (which streams a buffer and never touches ok()), and a crawler
 * test that signs in as each finance-blind role and asserts no response body anywhere
 * carries one of these keys.
 *
 * Mutates nothing: Mongoose documents are frequently shared across a request, and a
 * redacting deep-clone that quietly rewrote a document would corrupt anything saved
 * afterwards.
 */
function redact(data, user) {
  if (!user) return data;

  const held = permissionsFor(user.role);
  /* Which leaf names this particular caller loses. Computed once per response; for a
     caller who loses nothing — most of them — we return the payload untouched. */
  const strip = new Set(
    Object.keys(FIELD_PERMISSIONS).filter((f) => !held.includes(FIELD_PERMISSIONS[f])),
  );
  if (strip.size === 0) return data;

  return walk(data, strip, 0);
}

/* Depth cap: a cycle in a hand-built payload should degrade, not hang the request. */
const MAX_DEPTH = 24;

function walk(node, strip, depth) {
  if (node === null || typeof node !== 'object' || depth > MAX_DEPTH) return node;

  /* Mongoose documents, ObjectIds and Dates: convert to plain data first, or the
     spread below silently produces an object of internal symbols. */
  if (typeof node.toJSON === 'function' && !Array.isArray(node)) {
    return walk(node.toJSON(), strip, depth);
  }
  if (node instanceof Date) return node;

  if (Array.isArray(node)) return node.map((v) => walk(v, strip, depth + 1));

  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (strip.has(k)) continue;
    out[k] = walk(v, strip, depth + 1);
  }
  return out;
}

module.exports = { redact };
