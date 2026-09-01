'use strict';
const jwt  = require('jsonwebtoken');
const User = require('../../src/models/User');

async function insertUser(attrs = {}) {
  const role = attrs.role || 'sales_executive';

  /* Agent and User were separate collections, so a suite would legitimately create an
     agent profile and a login with the SAME email. They are one record now, so a second
     call for an email already present returns that record instead of colliding on the
     unique index — which is also what the fixture meant: one person, described twice. */
  if (attrs.email) {
    const existing = await User.collection.findOne({ email: attrs.email });
    if (existing) return existing._id;
  }

  const doc = {
    name:        attrs.name        || role,
    email:       attrs.email       || `${role}_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
    password:    '$2b$01$placeholder',
    role,
    /* Org chart. `chain` is normally maintained by orgService, but this helper writes
       through the driver to stay fast, so a fixture that sets reportsTo must set chain
       too — otherwise every 'team' scope resolves to an empty subtree and the tests pass
       for the wrong reason. helpers/roles.js does this for you; prefer it. */
    reportsTo:   attrs.reportsTo   || null,
    chain:       attrs.chain       || (attrs.reportsTo ? [attrs.reportsTo] : []),
    domain:      attrs.domain      || 'none',
    territory:   attrs.territory   || '',
    target:      attrs.target      ?? 0,
    expoId:      attrs.expoId      || null,
    expiresAt:   attrs.expiresAt   ?? null,
    isTemporary: attrs.isTemporary || false,
    isActive:    attrs.isActive    ?? true,
    lastLogin:   null,
    createdAt:   new Date(),
    updatedAt:   new Date(),
  };

  /* The check above is check-then-act: if a previous test timed out and its setup is
     still running, both calls miss the findOne and both insert. Return the winner rather
     than throwing, so a stalled run produces ONE timeout instead of a cascade of dup-key
     failures that hides what actually went wrong. */
  try {
    const res = await User.collection.insertOne(doc);
    return res.insertedId;
  } catch (err) {
    if (err && err.code === 11000) {
      const winner = await User.collection.findOne({ email: doc.email });
      if (winner) return winner._id;
    }
    throw err;
  }
}

function tok(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = { insertUser, tok, authHeader };
