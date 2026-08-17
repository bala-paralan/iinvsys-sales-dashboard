'use strict';
/**
 * Pagination parsing — N-1.
 *
 * Every list controller previously did:
 *
 *     const skip = (parseInt(page) - 1) * parseInt(limit);
 *
 * which has two problems:
 *
 *   1. `?page=0` yields skip = -limit, and `?page=-5` yields a larger negative.
 *      Mongo rejects a negative skip, so the request answered **500**. A query
 *      string a user can type should never be a server error.
 *   2. `?limit=100000` was honoured, so any caller could ask the process to
 *      load the entire collection into memory.
 *
 * This helper clamps both and is the single place either rule changes.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT     = 200;

/**
 * @param {object} query        req.query
 * @param {object} [opts]
 * @param {number} [opts.defaultLimit]
 * @param {number} [opts.maxLimit]
 * @returns {{page:number, limit:number, skip:number}} always safe for Mongo
 */
function parsePaging(query = {}, opts = {}) {
  const defaultLimit = opts.defaultLimit || DEFAULT_LIMIT;
  const maxLimit     = opts.maxLimit     || MAX_LIMIT;

  /* parseInt('abc') is NaN, parseInt('3x') is 3 — both are handled by the
     Number.isFinite guard plus the clamp below. */
  const rawPage  = parseInt(query.page, 10);
  const rawLimit = parseInt(query.limit, 10);

  const page  = Number.isFinite(rawPage)  && rawPage  >= 1 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1
    ? Math.min(rawLimit, maxLimit)
    : defaultLimit;

  return { page, limit, skip: (page - 1) * limit };
}

module.exports = { parsePaging, DEFAULT_LIMIT, MAX_LIMIT };
