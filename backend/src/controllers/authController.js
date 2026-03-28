'use strict';
const jwt  = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const User  = require('../models/User');
const Agent = require('../models/Agent');
const { ok, created, badRequest, unauthorized, unprocessable } = require('../utils/response');

/* ── helpers ─────────────────────────────────────────────────────── */

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

/* ── POST /api/auth/login ────────────────────────────────────────── */

async function login(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    const { email, password } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return unauthorized(res, 'Invalid email or password');
    }
    if (!user.isActive) return unauthorized(res, 'Account is deactivated');

    user.lastLogin = new Date();
    await user.save();

    const token = signToken(user._id);

    /* Attach agent profile if role=agent */
    let agentProfile = null;
    if (user.role === 'agent' && user.agentId) {
      agentProfile = await Agent.findById(user.agentId).lean();
    }

    return ok(res, { token, user, agentProfile }, 'Login successful');
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/auth/me ────────────────────────────────────────────── */

async function getMe(req, res, next) {
  try {
    let agentProfile = null;
    if (req.user.role === 'agent' && req.user.agentId) {
      agentProfile = await Agent.findById(req.user.agentId).lean();
    }
    return ok(res, { user: req.user, agentProfile });
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/auth/register (superadmin only) ───────────────────── */

async function register(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    const { name, email, password, role, agentId } = req.body;

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return badRequest(res, 'Email already in use');

    const user = await User.create({ name, email, password, role: role || 'readonly', agentId });
    return created(res, { user }, 'User created');
  } catch (err) {
    next(err);
  }
}

/* ── PATCH /api/auth/password ────────────────────────────────────── */

async function changePassword(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id).select('+password');
    if (!(await user.comparePassword(currentPassword))) {
      return unauthorized(res, 'Current password is incorrect');
    }

    user.password = newPassword;
    await user.save();
    return ok(res, {}, 'Password changed');
  } catch (err) {
    next(err);
  }
}

module.exports = { login, getMe, register, changePassword };
