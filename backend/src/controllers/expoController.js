'use strict';
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const Expo = require('../models/Expo');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { ok, created, notFound, unprocessable, paginated, badRequest } = require('../utils/response');
const { parsePaging } = require('../utils/pagination');
const Invite = require('../models/Invite');
const audit = require('../services/auditService');

/**
 * Where the referrer should be sent to redeem their invite.
 *
 * Taken from configuration, NOT from the request Host header — an attacker who
 * can set Host would otherwise get the app to mint invite links pointing at
 * their own domain, and an admin forwarding that link hands over the token.
 */
function publicOrigin() {
  const configured = (process.env.PUBLIC_APP_URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  const firstCors = (process.env.CORS_ORIGINS || '').split(',')[0].trim();
  return firstCors || 'http://localhost:5173';
}

/* ── GET /api/expos ──────────────────────────────────────────────── */

async function listExpos(req, res, next) {
  try {
    const { status, city } = req.query;
    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 20 });

    const filter = {};
    if (status) filter.status = status;
    if (city)   filter.city   = new RegExp(city, 'i');

    /* A referrer sees only the expo they are attached to. Their own account
       carries the id, so this cannot be widened from the query string. */
    if (req.referrerExpoId) {
      filter._id = req.referrerExpoId;
    } else if (req.user.role === 'referrer') {
      return paginated(res, [], 0, page, limit);
    }

    const [expos, total] = await Promise.all([
      Expo.find(filter)
        .populate('agents', 'name initials color')
        .populate('products.product', 'name sku price')
        .populate('products.presenters', 'name initials color')
        .sort({ startDate: -1 })
        .skip(skip).limit(limit)
        .lean(),
      Expo.countDocuments(filter),
    ]);
    return paginated(res, expos, total, page, limit);
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/expos/:id ──────────────────────────────────────────── */

async function getExpo(req, res, next) {
  try {
    /* A referrer may only fetch their own expo. Answer 404 rather than 403 so
       the endpoint cannot be used to probe which expo ids exist. */
    if (req.user.role === 'referrer'
        && String(req.referrerExpoId || '') !== String(req.params.id)) {
      return notFound(res, 'Expo not found');
    }

    const expo = await Expo.findById(req.params.id)
      .populate('agents', 'name initials color designation')
      .populate('products.product', 'name sku price category')
      .populate('products.presenters', 'name initials color designation')
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
    const populated = await Expo.findById(expo._id)
      .populate('agents', 'name initials color')
      .populate('products.product', 'name sku price')
      .populate('products.presenters', 'name initials color')
      .lean();
    return created(res, populated, 'Expo created');
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
    const populated = await Expo.findById(expo._id)
      .populate('agents', 'name initials color')
      .populate('products.product', 'name sku price')
      .populate('products.presenters', 'name initials color')
      .lean();
    return ok(res, populated, 'Expo updated');
  } catch (err) {
    next(err);
  }
}

/* ── DELETE /api/expos/:id ───────────────────────────────────────── */

async function deleteExpo(req, res, next) {
  try {
    const expo = await Expo.findByIdAndDelete(req.params.id);
    if (!expo) return notFound(res, 'Expo not found');

    /* Leads keep their `expo` reference, which now dangles. Record the count so
       an orphaned reference can be traced back to this deletion. */
    const leadCount = await Lead.countDocuments({ expo: expo._id });
    await audit.destruction({
      entityType: 'expo',
      entityId: expo._id,
      label: expo.name,
      snapshot: {
        name: expo.name, city: expo.city, venue: expo.venue,
        startDate: expo.startDate, endDate: expo.endDate,
        status: expo.status, orphanedLeads: leadCount,
      },
    }, req);
    return ok(res, {}, 'Expo deleted');
  } catch (err) {
    next(err);
  }
}

/* ── PUT /api/expos/:id/products ── replace products+presenters list ── */

async function updateExpoProducts(req, res, next) {
  try {
    const { products, agents } = req.body; // products: [{product, presenters:[agentId]}]
    const update = {};
    if (Array.isArray(products)) update.products = products;
    if (Array.isArray(agents))   update.agents   = agents;

    const expo = await Expo.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('products.product', 'name sku price')
      .populate('products.presenters', 'name initials color')
      .populate('agents', 'name initials color')
      .lean();
    if (!expo) return notFound(res, 'Expo not found');
    return ok(res, expo, 'Expo products updated');
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/expos/:id/referrers ── create temp referrer account ── */

async function createReferrer(req, res, next) {
  try {
    const expo = await Expo.findById(req.params.id).lean();
    if (!expo) return notFound(res, 'Expo not found');

    const { name } = req.body;
    if (!name) return badRequest(res, 'name is required');

    /* No password in the request either. An admin-chosen password is a
       password the admin still knows after handing it over. */
    const slug  = name.toLowerCase().replace(/\s+/g, '.') + '.' + Date.now().toString(36);
    const email = `${slug}@ref.${expo._id.toString().slice(-6)}.iinvsys`;

    const existing = await User.findOne({ email });
    if (existing) return badRequest(res, 'A referrer with that name already exists for this expo');

    /* The account starts with an unusable random password. The referrer sets a
       real one by redeeming the invite; until then the account cannot be
       signed into at all, so an un-redeemed invite leaves no live credential
       lying around. */
    const user = await User.create({
      name,
      email,
      password: crypto.randomBytes(24).toString('base64url'),
      role:      'referrer',
      expoId:    expo._id,
      expiresAt: null, // referrers never expire — admin must delete manually
      isActive:  true,
    });

    const { invite, token } = await Invite.mint({ user: user._id, createdBy: req.user._id });

    await audit.record({
      action: 'user.create', entityType: 'user', entityId: user._id,
      summary: `Referrer ${name} invited to expo ${expo.name}`,
      meta: { expoId: String(expo._id), inviteId: String(invite._id) },
    }, req);

    return created(res, {
      id:        user._id,
      name:      user.name,
      email:     user.email,
      expoId:    user.expoId,
      expiresAt: null,
      /* Shown ONCE, never stored in retrievable form: only its SHA-256 hash
         is persisted. Re-issuing mints a new link and kills this one. */
      inviteToken: token,
      inviteUrl:   `${publicOrigin()}/invite/${token}`,
      inviteExpiresAt: invite.expiresAt,
    }, 'Referrer invited — share the link once; it cannot be shown again');
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/expos/:id/referrers/:uid/reinvite ─────────────────── */

async function reinviteReferrer(req, res, next) {
  try {
    const user = await User.findOne({
      _id: req.params.uid, expoId: req.params.id, role: 'referrer',
    });
    if (!user) return notFound(res, 'Referrer not found');

    const { invite, token } = await Invite.mint({ user: user._id, createdBy: req.user._id });

    await audit.record({
      action: 'auth.password_change', entityType: 'user', entityId: user._id,
      summary: `Invite re-issued for referrer ${user.name}`,
      meta: { inviteId: String(invite._id) },
    }, req);

    return ok(res, {
      inviteToken: token,
      inviteUrl: `${publicOrigin()}/invite/${token}`,
      inviteExpiresAt: invite.expiresAt,
    }, 'New invite issued — any previous link is now dead');
  } catch (err) { next(err); }
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

    const captured = await Lead.countDocuments({ createdBy: user._id });
    await audit.destruction({
      entityType: 'user',
      entityId: user._id,
      label: user.name,
      reason: 'referrer account removed',
      snapshot: {
        name: user.name, email: user.email, expoId: user.expoId,
        leadsCaptured: captured, lastLogin: user.lastLogin,
      },
    }, req);
    return ok(res, {}, 'Referrer account deleted');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listExpos, getExpo, createExpo, updateExpo, deleteExpo, updateExpoProducts,
  createReferrer, reinviteReferrer, listReferrers, deleteReferrer,
};
