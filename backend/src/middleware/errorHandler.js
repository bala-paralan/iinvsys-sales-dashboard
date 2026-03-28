'use strict';

/**
 * Centralised error-handling middleware.
 * Must be registered LAST in Express middleware chain.
 */
function errorHandler(err, req, res, next) {   // eslint-disable-line no-unused-vars
  /* ── Mongoose validation error ─────────────────────────────────────── */
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(422).json({ success: false, message: 'Validation failed', errors });
  }

  /* ── Mongoose duplicate-key error ───────────────────────────────────── */
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      message: `Duplicate value for '${field}'`,
    });
  }

  /* ── Mongoose cast error (bad ObjectId) ─────────────────────────────── */
  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, message: `Invalid ${err.path}: ${err.value}` });
  }

  /* ── JWT errors (should be caught in auth middleware, belt+suspenders) ─ */
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }

  /* ── express-validator / manual HTTP errors ─────────────────────────── */
  if (err.statusCode) {
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }

  /* ── Fallback: 500 Internal Server Error ────────────────────────────── */
  const isDev = process.env.NODE_ENV === 'development';
  console.error('[ErrorHandler]', err);
  return res.status(500).json({
    success: false,
    message: 'Internal server error',
    ...(isDev && { stack: err.stack }),
  });
}

module.exports = errorHandler;
