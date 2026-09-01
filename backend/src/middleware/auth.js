'use strict';
const jwt  = require('jsonwebtoken');
const User = require('../models/User');
const { unauthorized } = require('../utils/response');

/**
 * Verifies JWT and attaches decoded user to req.user
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return unauthorized(res, 'No token provided');
    }

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId).select('-password');
    if (!user || !user.isActive) {
      return unauthorized(res, 'Account not found or deactivated');
    }

    req.user = user;
    /* utils/response.js redacts every payload against the caller, and ok()/created()/
       paginated() are handed a response, not a request — res.locals is the only place
       they can read the caller from. Set both, always, in the same statement, so the
       two can never disagree. */
    res.locals.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return unauthorized(res, 'Token expired');
    if (err.name === 'JsonWebTokenError')  return unauthorized(res, 'Invalid token');
    next(err);
  }
}

module.exports = { authenticate };
