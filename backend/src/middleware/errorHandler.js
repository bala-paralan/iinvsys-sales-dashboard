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

  /* Structured, and carrying the request id — an unhandled error is exactly
     the log line someone will need to correlate with a user's report. */
  if (process.env.NODE_ENV === 'production') {
    process.stdout.write(`${JSON.stringify({
      t: new Date().toISOString(), level: 'error', requestId: req.id,
      method: req.method, path: req.originalUrl.split('?')[0],
      error: err.message, name: err.name, stack: err.stack,
    })}\n`);
  } else if (process.env.NODE_ENV !== 'test') {
    console.error('[ErrorHandler]', req.id, err);
  }

  return res.status(500).json({
    success: false,
    message: 'Internal server error',
    /* Echoed so a user can quote it and it can be grepped. Safe to expose:
       it is a random id, not a token, and it is already in a response header. */
    requestId: req.id,
    ...(isDev && { stack: err.stack }),
  });
}

module.exports = errorHandler;
