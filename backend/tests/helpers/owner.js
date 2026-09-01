'use strict';

/**
 * Lead-owner fixtures.
 *
 * The tests used to build lead owners with `Agent.create({name, initials, email, phone,
 * territory})`. `Agent` is retired — User is the only identity model — but every one of
 * those fields lives on User now, so the call sites stay as they were and this factory
 * supplies the two things a User needs and an Agent did not: a password and a role.
 *
 * Exposed with the Mongoose method names the tests already call, so converting a suite
 * is a one-line change to its require, not a rewrite of its fixtures.
 */
const User = require('../../src/models/User');

let n = 0;

function withDefaults(attrs = {}) {
  n += 1;
  return {
    role: 'sales_executive',
    password: 'FixturePass@123',
    ...attrs,
    /* AFTER the spread: an `email: undefined` in the fixture must not win over the
       generated one, or the User schema's `required` rejects it. */
    email: attrs.email || `owner${n}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@fixture.test`,
  };
}

/**
 * Agent and User were separate collections, so a test would create a login and an agent
 * profile with the SAME email quite legitimately. They are one record now, so the second
 * call adopts the first rather than colliding on the unique index — which is also what
 * the test meant: one person, described twice.
 */
async function createOne(attrs) {
  const doc = withDefaults(attrs);
  const existing = await User.findOne({ email: doc.email });
  if (!existing) {
    try {
      return await User.create(doc);
    } catch (err) {
      if (err && err.code === 11000) {
        const winner = await User.findOne({ email: doc.email });
        if (winner) return winner;
      }
      throw err;
    }
  }

  for (const [k, v] of Object.entries(doc)) {
    if (k === 'email' || k === 'password' || k === 'role' || v === undefined) continue;
    existing[k] = v;
  }
  await existing.save();
  return existing;
}

/* Same check-then-act race as helpers/testUtils.insertUser: return the winner rather than
   throwing, so a stalled run produces one timeout instead of a dup-key cascade. */

const Owner = {
  create(attrs) {
    if (Array.isArray(attrs)) return Promise.all(attrs.map(createOne));
    return createOne(attrs);
  },
  insertMany(rows) {
    /* insertMany skips the password-hashing save hook, which is fine for a fixture and
       is what the Agent version did anyway. */
    return User.insertMany(rows.map(withDefaults));
  },
  findById: (...a) => User.findById(...a),
  findOne:  (...a) => User.findOne(...a),
  find:     (...a) => User.find(...a),
  countDocuments: (...a) => User.countDocuments(...a),
  deleteMany: (...a) => User.deleteMany(...a),
  updateOne:  (...a) => User.updateOne(...a),
  schema: User.schema,
};

module.exports = Owner;
