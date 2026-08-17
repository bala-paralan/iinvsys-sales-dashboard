'use strict';
/**
 * Invite.js — a single-use, expiring credential handover. (N-5)
 *
 * Replaces `POST /api/expos/:id/referrers` returning a plaintext password in
 * the response body. That password was chosen by the admin, travelled through
 * the API response, sat in the browser's network log, and was then relayed
 * over WhatsApp — and because it was in the JSON it also reached anything that
 * logged response bodies. It could not be rotated, because nobody recorded who
 * had seen it.
 *
 * What is stored here is a SHA-256 HASH of the token, never the token itself.
 * The raw token is returned exactly once, at creation. A database dump
 * therefore yields nothing usable, which is the whole point on a host with two
 * prior ransomware wipes.
 */
const mongoose = require('mongoose');
const crypto = require('crypto');

const INVITE_TTL_HOURS = Number(process.env.INVITE_TTL_HOURS) || 72;

const InviteSchema = new mongoose.Schema({
  /* The account this invite sets a password for. */
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  /** SHA-256 of the raw token. Never the token. */
  tokenHash: { type: String, required: true, unique: true },

  purpose: { type: String, enum: ['referrer_setup', 'password_reset'], default: 'referrer_setup' },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  expiresAt: { type: Date, required: true },

  /* Single use. `redeemedAt` is what makes a leaked-but-used token harmless,
     and what lets an admin see that an invite was actually taken up. */
  redeemedAt: { type: Date, default: null },
  redeemedIp: { type: String, default: '' },
}, { timestamps: true });

/* Mongo removes the document once it expires. The `redeemedAt` check below is
   still required — TTL eviction runs about once a minute, so an expired token
   can remain readable for up to a minute after it should have died. */
InviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const hash = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

/**
 * Mint an invite.
 * @returns {{invite: object, token: string}} the raw token, returned ONCE
 */
InviteSchema.statics.mint = async function mint({ user, createdBy, purpose = 'referrer_setup', ttlHours = INVITE_TTL_HOURS }) {
  /* 32 bytes base64url — 256 bits. Not `Math.random()`, which is not a CSPRNG
     and is what the legacy referrer-password generator used. */
  const token = crypto.randomBytes(32).toString('base64url');

  /* One live invite per user: minting a replacement must invalidate the
     previous link, or an admin who re-sends because "it didn't arrive" leaves
     two working credentials in circulation. */
  await this.deleteMany({ user, redeemedAt: null });

  const invite = await this.create({
    user,
    tokenHash: hash(token),
    purpose,
    createdBy: createdBy || null,
    expiresAt: new Date(Date.now() + ttlHours * 3600000),
  });

  return { invite, token };
};

/**
 * Look up a live invite by its raw token.
 * @returns {Promise<object|null>} null when unknown, expired or already used
 */
InviteSchema.statics.findLive = function findLive(token) {
  if (!token) return Promise.resolve(null);
  return this.findOne({
    tokenHash: hash(token),
    redeemedAt: null,
    expiresAt: { $gt: new Date() },
  });
};

InviteSchema.statics.hashToken = hash;
InviteSchema.statics.TTL_HOURS = INVITE_TTL_HOURS;

module.exports = mongoose.model('Invite', InviteSchema);
