'use strict';
const jwt  = require('jsonwebtoken');
const User = require('../../src/models/User');

async function insertUser(attrs = {}) {
  const role = attrs.role || 'agent';
  const res  = await User.collection.insertOne({
    name:        attrs.name        || role,
    email:       attrs.email       || `${role}_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
    password:    '$2b$01$placeholder',
    role,
    agentId:     attrs.agentId     || null,
    expoId:      attrs.expoId      || null,
    expiresAt:   attrs.expiresAt   ?? null,
    isTemporary: attrs.isTemporary || false,
    isActive:    attrs.isActive    ?? true,
    lastLogin:   null,
    createdAt:   new Date(),
    updatedAt:   new Date(),
  });
  return res.insertedId;
}

function tok(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = { insertUser, tok, authHeader };
