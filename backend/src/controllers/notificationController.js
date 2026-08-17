'use strict';
/**
 * Notification centre — R-8.
 *
 * Everything here is scoped to `req.user._id` at the query level, never by a
 * filter the caller supplies. A notification names the record it concerns, and
 * those records span the whole business — a warehouse operator's alert can
 * reference a customer, a lead's alert can reference a deal value. Letting a
 * caller ask for someone else's notifications would route around every
 * permission boundary the rest of the system enforces.
 */
const Notification = require('../models/Notification');
const { unreadCount } = require('../services/notificationService');
const { ok, notFound, paginated } = require('../utils/response');
const { parsePaging } = require('../utils/pagination');

/* ── GET /api/notifications ──────────────────────────────────────────── */

async function listNotifications(req, res, next) {
  try {
    /* `user` is set from the token, never from the query string. */
    const filter = { user: req.user._id };
    if (req.query.unread === 'true') filter.readAt = null;
    if (req.query.severity) filter.severity = req.query.severity;
    if (req.query.event) filter.event = req.query.event;

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 30 });

    const [items, total, unread] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Notification.countDocuments(filter),
      unreadCount(req.user._id),
    ]);

    return paginated(res, { notifications: items, unread }, total, page, limit);
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/notifications/unread-count ─────────────────────────────── */

async function getUnreadCount(req, res, next) {
  try {
    return ok(res, { unread: await unreadCount(req.user._id) });
  } catch (err) {
    next(err);
  }
}

/* ── PATCH /api/notifications/:id/read ───────────────────────────────── */

async function markRead(req, res, next) {
  try {
    /* Scoped in the QUERY, so someone else's id simply is not found — the
       endpoint cannot be used to probe which notification ids exist. */
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { $set: { readAt: new Date() } },
      { new: true },
    );
    if (!n) return notFound(res, 'Notification not found');
    return ok(res, n, 'Marked as read');
  } catch (err) {
    next(err);
  }
}

/* ── PATCH /api/notifications/read-all ───────────────────────────────── */

async function markAllRead(req, res, next) {
  try {
    const result = await Notification.updateMany(
      { user: req.user._id, readAt: null },
      { $set: { readAt: new Date() } },
    );
    return ok(res, { updated: result.modifiedCount }, 'All marked as read');
  } catch (err) {
    next(err);
  }
}

module.exports = { listNotifications, getUnreadCount, markRead, markAllRead };
