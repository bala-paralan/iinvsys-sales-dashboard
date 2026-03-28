'use strict';

/** 200 OK */
const ok = (res, data = {}, message = 'Success') =>
  res.status(200).json({ success: true, message, data });

/** 201 Created */
const created = (res, data = {}, message = 'Created') =>
  res.status(201).json({ success: true, message, data });

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

/** 409 Conflict */
const conflict = (res, message = 'Conflict') =>
  res.status(409).json({ success: false, message });

/** 422 Unprocessable Entity */
const unprocessable = (res, message = 'Validation failed', errors = []) =>
  res.status(422).json({ success: false, message, ...(errors.length && { errors }) });

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
    data: items,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });

module.exports = { ok, created, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable, paginated };
