'use strict';
/**
 * requestContext.js — a request id on every request, and structured JSON logs
 * in production. (N-3)
 *
 * Two problems this solves:
 *
 *   · **No correlation.** A 500 in the logs could not be tied to the client
 *     that saw it. The id is echoed in `X-Request-Id` and included in the
 *     error body, so a user can quote it and it can be grepped.
 *   · **morgan's `combined` format is not machine-readable.** It cannot be
 *     queried by status, route or duration without regex archaeology, which
 *     is exactly what you are doing at 3am. Production emits one JSON object
 *     per request; development keeps the readable single line.
 */
const crypto = require('crypto');

/** Attach (or adopt) a request id. */
function requestId(req, res, next) {
  /* Honour an upstream id so a trace survives the proxy hop, but only if it
     looks like one — an unbounded client-supplied string ends up in logs. */
  const inbound = req.get('X-Request-Id');
  req.id = (typeof inbound === 'string' && /^[\w-]{8,64}$/.test(inbound))
    ? inbound
    : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

/** Fields that must never reach a log line. */
const REDACT = new Set(['password', 'token', 'authorization', 'newPassword', 'currentPassword']);

function safeQuery(query) {
  const out = {};
  for (const [k, v] of Object.entries(query || {})) {
    out[k] = REDACT.has(k) ? '[redacted]' : v;
  }
  return out;
}

/**
 * One JSON object per completed request.
 *
 * Logged on `finish`, not on entry, so status and duration are known — a log
 * line written before the handler runs cannot say what happened.
 */
function jsonLogger(req, res, next) {
  const started = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const line = {
      t: new Date().toISOString(),
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      requestId: req.id,
      method: req.method,
      /* route, not originalUrl: `/api/leads/:id` aggregates, and an id in the
         path makes every request its own unique "route". */
      route: (req.route && req.route.path) || req.baseUrl || req.path,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      /* Who, for an authenticated request. Id and role only — never the email,
         which is personal data that does not belong in an access log. */
      userId: req.user ? String(req.user._id) : null,
      role: req.user ? req.user.role : null,
      ip: req.ip,
      query: safeQuery(req.query),
    };
    process.stdout.write(`${JSON.stringify(line)}\n`);
  });

  next();
}

module.exports = { requestId, jsonLogger, safeQuery, REDACT };
