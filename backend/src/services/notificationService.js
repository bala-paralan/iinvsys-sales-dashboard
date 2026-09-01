'use strict';
/**
 * notificationService — R-8.
 *
 * Two design decisions carry this module:
 *
 * 1. **Recipients resolve by permission, not by role name.** A caller says
 *    "whoever can accept a Work Order", not "the delivery_manager". The role
 *    mapping is allowed to change; the job is not. See models/Notification.js.
 *
 * 2. **A sweep must be idempotent.** `notifyOnce()` suppresses a repeat of the
 *    same (user, event, entity) inside a cooldown window. Without it the
 *    nightly inactivity sweep would tell a Sales Manager about the same stale
 *    lead every morning until someone touched it, and the notification centre
 *    would become noise people scroll past — which costs more than sending
 *    nothing, because it also buries the alerts that DO matter.
 *
 * Delivery failures never propagate: a notification is a side effect of a
 * business operation, and losing one must not roll back the operation that
 * produced it. Same reasoning as auditService.record().
 */
const Notification = require('../models/Notification');
const User = require('../models/User');
const { rolesWith } = require('../config/permissions');

const DEFAULT_COOLDOWN_HOURS = 24;

/**
 * Users who hold ANY of the given permissions.
 * @param {string[]} permissions
 * @returns {Promise<Array>} active users
 */
async function recipientsFor(permissions) {
  const perms = Array.isArray(permissions) ? permissions : [permissions];
  const roles = [...new Set(perms.flatMap((p) => rolesWith(p)))];
  if (!roles.length) return [];
  return User.find({ role: { $in: roles }, isActive: true }).select('_id name email role').lean();
}

/**
 * Send one notification to an explicit set of users.
 * @returns {Promise<Array>} the created documents (empty on failure)
 */
async function notifyUsers(users, entry) {
  if (!users || !users.length) return [];
  try {
    const docs = users.map((u) => ({
      event: entry.event,
      severity: entry.severity || 'info',
      title: entry.title,
      body: entry.body || '',
      entityType: entry.entityType || null,
      entityId: entry.entityId || null,
      user: u._id || u,
      reason: entry.reason || '',
      meta: entry.meta || {},
    }));
    return await Notification.insertMany(docs);
  } catch (err) {
    console.error(`NOTIFICATION FAILED [${entry.event}] ${entry.title}: ${err.message}`);
    return [];
  }
}

/**
 * Notify everyone holding a permission.
 *
 * @param {string|string[]} permissions
 * @param {object} entry  { event, severity, title, body, entityType, entityId, meta }
 * @param {object} [opts] { excludeUserId } — do not tell someone about their own action
 */
async function notifyByPermission(permissions, entry, opts = {}) {
  const perms = Array.isArray(permissions) ? permissions : [permissions];
  let users = await recipientsFor(perms);

  if (opts.excludeUserId) {
    users = users.filter((u) => String(u._id) !== String(opts.excludeUserId));
  }

  return notifyUsers(users, {
    ...entry,
    reason: entry.reason || `holds ${perms.join(' or ')}`,
  });
}

/**
 * Notify, but only if this exact (user, event, entity) has not been sent
 * recently. This is what makes a nightly sweep safe to run nightly.
 *
 * @param {Array} users
 * @param {object} entry
 * @param {number} [cooldownHours]
 * @returns {Promise<{sent:Array, suppressed:number}>}
 */
async function notifyOnce(users, entry, cooldownHours = DEFAULT_COOLDOWN_HOURS) {
  if (!users || !users.length) return { sent: [], suppressed: 0 };

  const since = new Date(Date.now() - cooldownHours * 3600000);
  const recent = await Notification.find({
    user: { $in: users.map((u) => u._id || u) },
    event: entry.event,
    entityId: entry.entityId || null,
    createdAt: { $gte: since },
  }).select('user').lean();

  const alreadyTold = new Set(recent.map((n) => String(n.user)));
  const fresh = users.filter((u) => !alreadyTold.has(String(u._id || u)));

  const sent = await notifyUsers(fresh, entry);
  return { sent, suppressed: users.length - fresh.length };
}

/** Unread count for a user — the number on the bell. */
/**
 * Notify ONE person.
 *
 * The counterpart to notifyByPermission, and the right default for anything addressed to
 * an individual — an approval waiting on their decision, a lead assigned to them. Fanning
 * such a thing out by permission would tell all four Sales Managers about a decision only
 * one of them can take, and the notification centre stops being read.
 */
async function notifyUser(userOrId, entry) {
  if (!userOrId) return [];
  return notifyUsers([userOrId], entry);
}

function unreadCount(userId) {
  return Notification.countDocuments({ user: userId, readAt: null });
}

module.exports = {
  notifyUser,
  recipientsFor, notifyUsers, notifyByPermission, notifyOnce, unreadCount,
  DEFAULT_COOLDOWN_HOURS,
};
