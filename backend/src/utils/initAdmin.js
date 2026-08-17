'use strict';
/**
 * initAdmin — runs once on every server startup.
 * If the database has zero users, a superadmin account is created
 * automatically so the system is never locked out.
 *
 * The password comes from the ADMIN_PASSWORD env var. There is deliberately no
 * shared default: a well-known bootstrap password on an internet-reachable
 * deployment is how the account gets taken, not a convenience.
 *
 *   - production : ADMIN_PASSWORD is REQUIRED. Boot fails loudly without it.
 *   - otherwise  : a random 24-char password is generated and printed ONCE.
 *
 * Change it after first login via Settings → Change Password.
 */
const crypto = require('crypto');
const User   = require('../models/User');

/** URL-safe random password. 18 bytes → 24 base64url chars, ~144 bits. */
function generatePassword() {
  return crypto.randomBytes(18).toString('base64url');
}

async function initAdmin() {
  const count = await User.countDocuments();
  if (count > 0) return; // users already exist — nothing to do

  let rawPassword = process.env.ADMIN_PASSWORD;
  let generated   = false;

  if (!rawPassword) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ADMIN_PASSWORD must be set to bootstrap the first superadmin in production. ' +
        'Refusing to create an account with a default password.'
      );
    }
    rawPassword = generatePassword();
    generated   = true;
  }

  // Pass plain-text — the User pre-save hook hashes it automatically.
  // Do NOT pre-hash here; double-hashing breaks comparePassword().
  await User.create({
    name:     'Admin IINVSYS',
    email:    (process.env.ADMIN_EMAIL || 'admin@iinvsys.com').toLowerCase(),
    password: rawPassword,
    role:     'superadmin',
    isActive: true,
  });

  console.log('✅  Auto-init: superadmin account created');
  console.log(`    Email   : ${process.env.ADMIN_EMAIL || 'admin@iinvsys.com'}`);
  if (generated) {
    console.log(`    Password: ${rawPassword}`);
    console.log('    ⚠️  Generated once and NOT stored anywhere — copy it now.\n');
  } else {
    console.log('    Password: (from the ADMIN_PASSWORD env var)');
    console.log('    ⚠️  Change the password after first login.\n');
  }
}

module.exports = initAdmin;
module.exports.generatePassword = generatePassword;
