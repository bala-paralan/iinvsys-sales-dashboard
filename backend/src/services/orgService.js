'use strict';

/**
 * orgService.js — the reporting hierarchy.
 *
 * `User.chain` is a materialised ancestor path (root-first). It exists so that
 * "everyone under me, at any depth" is one indexed query rather than a recursive walk
 * repeated on every list request:
 *
 *     User.find({ chain: managerId })      // the whole subtree, one hit on {chain:1}
 *
 * The cost is that `chain` is derived state which must be repaired whenever a
 * reporting line moves. Every write to `reportsTo` goes through setManager() —
 * nothing else may touch either field.
 */

const User = require('../models/User');

/** The chain a user should have, given their manager. */
async function chainFor(managerId) {
  if (!managerId) return [];
  const mgr = await User.findById(managerId).select('chain').lean();
  if (!mgr) throw Object.assign(new Error('Manager not found'), { code: 'MANAGER_NOT_FOUND' });
  return [...(mgr.chain || []), mgr._id];
}

/**
 * Point `userId` at a new manager and repair the subtree.
 *
 * Rejects a cycle: a user may not report to anyone already beneath them, nor to
 * themselves. Without this, one bad assignment makes `chain` infinite and every
 * subtree query wrong in a way that is very hard to see.
 */
async function setManager(userId, managerId) {
  const user = await User.findById(userId).select('chain reportsTo');
  if (!user) throw Object.assign(new Error('User not found'), { code: 'USER_NOT_FOUND' });

  const uid = String(user._id);
  if (managerId && String(managerId) === uid) {
    throw Object.assign(new Error('A user cannot report to themselves'), { code: 'ORG_CYCLE' });
  }
  if (managerId) {
    const mgr = await User.findById(managerId).select('chain').lean();
    if (!mgr) throw Object.assign(new Error('Manager not found'), { code: 'MANAGER_NOT_FOUND' });
    if ((mgr.chain || []).some((a) => String(a) === uid)) {
      throw Object.assign(new Error('That manager already reports to this user'), { code: 'ORG_CYCLE' });
    }
  }

  const oldChain = user.chain || [];
  const newChain = await chainFor(managerId);

  user.reportsTo = managerId || null;
  user.chain = newChain;
  await user.save();

  /* Everyone beneath this user keeps their position relative to it, so their chain is
     (newChain + user) followed by whatever sat below `user` in their old chain. One
     updateMany would need a per-document expression, so use an aggregation pipeline
     update — supported by MongoDB 4.2+ and by mongodb-memory-server. */
  const oldPrefixLen = oldChain.length + 1;
  await User.updateMany(
    { chain: user._id },
    [{
      $set: {
        chain: {
          $concatArrays: [
            [...newChain, user._id],
            { $slice: ['$chain', oldPrefixLen, { $size: '$chain' }] },
          ],
        },
      },
    }],
  );

  return user;
}

/** Every active user in `userId`'s subtree, excluding the user themselves. */
async function descendantIds(userId) {
  const rows = await User.find({ chain: userId, isActive: true }).select('_id').lean();
  return rows.map((r) => r._id);
}

/** Direct reports only — what the "Switch Exec ▼" pickers render. */
async function directReports(userId) {
  return User.find({ reportsTo: userId, isActive: true })
    .select('name role domain initials color').sort({ name: 1 }).lean();
}

/**
 * Create a user and place them in the org chart in one step, so `chain` can never be
 * missed on insert. `attrs.reportsTo` is honoured; everything else passes through.
 */
async function createUser(attrs) {
  const chain = await chainFor(attrs.reportsTo);
  return User.create({ ...attrs, chain });
}

module.exports = { chainFor, setManager, descendantIds, directReports, createUser };
