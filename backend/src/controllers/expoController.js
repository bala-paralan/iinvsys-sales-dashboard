'use strict';
const { validationResult } = require('express-validator');
const Expo = require('../models/Expo');
const Lead = require('../models/Lead');
const { ok, created, notFound, unprocessable, paginated } = require('../utils/response');

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

module.exports = { listExpos, getExpo, createExpo, updateExpo, deleteExpo };
