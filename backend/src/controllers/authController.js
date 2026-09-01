'use strict';
const jwt  = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const User  = require('../models/User');
const { ok, created, badRequest, unauthorized, unprocessable } = require('../utils/response');
const Invite = require('../models/Invite');
const audit = require('../services/auditService');
const orgService = require('../services/orgService');

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
      /* Logged with the CLAIMED email but no actor — nothing proved that
         identity. See auditService.login. */
      await audit.login({ ok: false, email, reason: 'invalid_credentials' }, req);
      return unauthorized(res, 'Invalid email or password');
    }
    if (!user.isActive) {
      await audit.login({ ok: false, email, reason: 'account_deactivated' }, req);
      return unauthorized(res, 'Account is deactivated');
    }

    /* Referrer expiry check */
    if (user.role === 'referrer' && user.expiresAt && new Date() > new Date(user.expiresAt)) {
      await audit.login({ ok: false, email, reason: 'referrer_expired' }, req);
      return unauthorized(res, 'This referrer account has expired');
    }

    user.lastLogin = new Date();
    await user.save();

    await audit.login({
      ok: true, email, userId: user._id, name: user.name, role: user.role,
    }, req);

    const token = signToken(user._id);

    /* `agentProfile` was a second document the legacy client fetched alongside the
       login. Its fields now live on User, so it is the same object — kept in the
       response under the old key so the legacy root app, still the default route in
       vercel.json, does not break during the cutover. */
    return ok(res, { token, user, agentProfile: user }, 'Login successful');
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/auth/me ────────────────────────────────────────────── */

async function getMe(req, res, next) {
  try {
    return ok(res, { user: req.user, agentProfile: req.user });
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/auth/register (superadmin only) ───────────────────── */

async function register(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    const { name, email, password, role, reportsTo } = req.body;

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return badRequest(res, 'Email already in use');

    /* Was `role || 'readonly'` — a role the enum no longer accepts, so every register
       call that omitted a role failed validation. `agentId` is gone with the Agent model;
       reporting lines are set through PATCH /api/users/:id/manager so `chain` is always
       maintained by orgService. */
    const user = await orgService.createUser({ name, email, password, role, reportsTo: reportsTo || null });
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

/* ── GET /api/auth/invite/:token ─────────────────────────────────
   Tell the redemption page whose invite this is, without revealing anything
   about an unknown or spent token beyond "not usable". */
async function checkInvite(req, res, next) {
  try {
    const invite = await Invite.findLive(req.params.token);
    if (!invite) return badRequest(res, 'This invitation link is invalid, expired or already used');

    const user = await User.findById(invite.user).select('name role expoId').lean();
    if (!user) return badRequest(res, 'This invitation link is invalid, expired or already used');

    return ok(res, {
      name: user.name, role: user.role,
      expiresAt: invite.expiresAt, purpose: invite.purpose,
    });
  } catch (err) { next(err); }
}

/* ── POST /api/auth/invite/:token ────────────────────────────────
   Redeem: the holder sets their own password and is signed in. This is the
   only place a referrer credential is ever chosen, and it is chosen by the
   referrer — nobody else, including the admin who invited them, ever knows it. */
async function redeemInvite(req, res, next) {
  try {
    const { password } = req.body || {};
    if (!password || String(password).length < 8) {
      return badRequest(res, 'Choose a password of at least 8 characters');
    }

    const invite = await Invite.findLive(req.params.token);
    if (!invite) return badRequest(res, 'This invitation link is invalid, expired or already used');

    const user = await User.findById(invite.user).select('+password');
    if (!user || !user.isActive) {
      return badRequest(res, 'This invitation link is invalid, expired or already used');
    }

    user.password = password;             // hashed by the pre-save hook
    await user.save();

    /* Burn the invite BEFORE returning the token. Marking it used after the
       response would leave a window in which two concurrent redemptions both
       succeed, and the second one would silently overwrite the first
       referrer's password. */
    invite.redeemedAt = new Date();
    invite.redeemedIp = req.ip;
    await invite.save();

    await audit.record({
      action: 'auth.password_change', entityType: 'user', entityId: user._id,
      summary: `${user.name} redeemed an invitation and set a password`,
      actor: { user: user._id, name: user.name, role: user.role },
    }, req);

    return ok(res, {
      token: signToken(user._id),
      user: { id: user._id, name: user.name, email: user.email, role: user.role, expoId: user.expoId },
    }, 'Password set — you are signed in');
  } catch (err) { next(err); }
}

module.exports = { login, getMe, register, changePassword, checkInvite, redeemInvite };
