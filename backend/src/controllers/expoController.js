'use strict';
const { validationResult } = require('express-validator');
const Expo = require('../models/Expo');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { ok, created, notFound, unprocessable, paginated, badRequest } = require('../utils/response');

/* ── GET /api/expos ──────────────────────────────────────────────── */

async function listExpos(req, res, next) {
  try {
    const { status, city, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (city)   filter.city   = new RegExp(city, 'i');

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [expos, total] = await Promise.all([
      Expo.find(filter)
        .populate('agents', 'name initials color')
        .sort({ startDate: -1 })
        .skip(skip).limit(parseInt(limit))
        .lean(),
      Expo.countDocuments(filter),
    ]);
    return paginated(res, expos, total, parseInt(page), parseInt(limit));
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/expos/:id ──────────────────────────────────────────── */

async function getExpo(req, res, next) {
  try {
    const expo = await Expo.findById(req.params.id)
      .populate('agents', 'name initials color designation')
      .lean();
    if (!expo) return notFound(res, 'Expo not found');

    const leadCount = await Lead.countDocuments({ expo: expo._id });
    return ok(res, { ...expo, leadCount });
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/expos ─────────────────────────────────────────────── */

async function createExpo(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    const expo = await Expo.create({ ...req.body, createdBy: req.user._id });
    return created(res, expo, 'Expo created');
  } catch (err) {
    next(err);
  }
}

/* ── PUT /api/expos/:id ──────────────────────────────────────────── */

async function updateExpo(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    const expo = await Expo.findByIdAndUpdate(req.params.id, req.body, {
      new: true, runValidators: true,
    });
    if (!expo) return notFound(res, 'Expo not found');
    return ok(res, expo, 'Expo updated');
  } catch (err) {
    next(err);
  }
}

/* ── DELETE /api/expos/:id ───────────────────────────────────────── */

async function deleteExpo(req, res, next) {
  try {
    const expo = await Expo.findByIdAndDelete(req.params.id);
    if (!expo) return notFound(res, 'Expo not found');
    return ok(res, {}, 'Expo deleted');
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/expos/:id/referrers ── create temp referrer account ── */

async function createReferrer(req, res, next) {
  try {
    const expo = await Expo.findById(req.params.id).lean();
    if (!expo) return notFound(res, 'Expo not found');

    const { name, password } = req.body;
    if (!name || !password) return badRequest(res, 'name and password are required');

    /* Generate unique email slug for this referrer */
    const slug  = name.toLowerCase().replace(/\s+/g, '.') + '.' + Date.now().toString(36);
    const email = `${slug}@ref.${expo._id.toString().slice(-6)}.iinvsys`;

    /* Referrer expires when expo ends */
    const expiresAt = expo.endDate ? new Date(expo.endDate) : null;

    const existing = await User.findOne({ email });
    if (existing) return badRequest(res, 'A referrer with that name already exists for this expo');

    const user = await User.create({
      name,
      email,
      password,
      role:        'referrer',
      expoId:      expo._id,
      expiresAt,
      isTemporary: true,
      isActive:    true,
    });

    return created(res, {
      id:       user._id,
      name:     user.name,
      email:    user.email,
      expoId:   user.expoId,
      expiresAt: user.expiresAt,
      password, // return plain-text once for admin to share
    }, 'Referrer account created');
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/expos/:id/referrers ────────────────────────────────── */

async function listReferrers(req, res, next) {
  try {
    const expo = await Expo.findById(req.params.id).lean();
    if (!expo) return notFound(res, 'Expo not found');

    const referrers = await User.find({ expoId: expo._id, role: 'referrer' })
      .select('-password').lean();

    /* Attach lead count per referrer */
    const withCounts = await Promise.all(referrers.map(async r => {
      const leadCount = await Lead.countDocuments({ expo: expo._id, createdBy: r._id });
      return { ...r, leadCount };
    }));

    return ok(res, withCounts);
  } catch (err) {
    next(err);
  }
}

/* ── DELETE /api/expos/:id/referrers/:uid ────────────────────────── */

async function deleteReferrer(req, res, next) {
  try {
    const user = await User.findOne({ _id: req.params.uid, role: 'referrer' });
    if (!user) return notFound(res, 'Referrer not found');
    await User.findByIdAndDelete(user._id);
    return ok(res, {}, 'Referrer account deleted');
  } catch (err) {
    next(err);
  }
}

module.exports = { listExpos, getExpo, createExpo, updateExpo, deleteExpo, createReferrer, listReferrers, deleteReferrer };
