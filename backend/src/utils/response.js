'use strict';

const { redact } = require('./redact');

/*
 * ok / created / paginated run every payload through redact() against res.locals.user.
 *
 * This is the only place every JSON response passes through, and therefore the only
 * place a newly added endpoint cannot forget. Doc 3 requires that a production engineer
 * never RECEIVES an order value — not that the value is hidden in the client — so the
 * enforcement has to be here rather than in a component.
 *
 * res.locals.user is set by middleware/auth.js alongside req.user; these helpers take a
 * response, not a request, so there is no other way to reach the caller.
 */

/** 200 OK */
const ok = (res, data = {}, message = 'Success') =>
  res.status(200).json({ success: true, message, data: redact(data, res.locals.user) });

/** 201 Created */
const created = (res, data = {}, message = 'Created') =>
  res.status(201).json({ success: true, message, data: redact(data, res.locals.user) });

/** 400 Bad Request */
const badRequest = (res, message = 'Bad request', errors = []) =>
  res.status(400).json({ success: false, message, ...(errors.length && { errors }) });

/** 401 Unauthorized */
const unauthorized = (res, message = 'Unauthorized') =>
  res.status(401).json({ success: false, message });

/** 403 Forbidden */
const forbidden = (res, message = 'Forbidden') =>
  res.status(403).json({ success: false, message });

/** 404 Not Found */
const notFound = (res, message = 'Not found') =>
  res.status(404).json({ success: false, message });

/** 409 Conflict. `extra` carries the alternatives — e.g. the duplicate candidates a
    customer create matched — so the client can offer a choice rather than just a refusal. */
const conflict = (res, message = 'Conflict', extra = null) =>
  res.status(409).json({ success: false, message, ...(extra || {}) });

/** 422 Unprocessable Entity */
const unprocessable = (res, message = 'Validation failed', errors = []) =>
  res.status(422).json({ success: false, message, ...(errors.length && { errors }) });

/**
 * A refused stage transition. Distinct from `unprocessable` because the client
 * needs the machine-readable `code` to tell a skipped stage from an unmet gate,
 * and `missing` to render the checklist of what is actually blocking the move.
 * See docs/requirements/03-stage-gates.md.
 */
const gateFailed = (res, code, message, missing = []) =>
  res.status(422).json({ success: false, code, message, missing });

/**
 * Paginated list response
 * @param {object} res
 * @param {Array}  items     - Current page items
 * @param {number} total     - Total matching documents
 * @param {number} page      - Current page (1-based)
 * @param {number} limit     - Page size
 */
const paginated = (res, items, total, page, limit) =>
  res.status(200).json({
    success: true,
    data: redact(items, res.locals.user),
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });

module.exports = { ok, created, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable, gateFailed, paginated };
