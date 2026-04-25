'use strict';
/**
 * initAdmin — runs once on every server startup.
 * If the database has zero users, a superadmin account is created
 * automatically so the system is never locked out.
 *
 * The password comes from the ADMIN_PASSWORD env var (default: Admin@123).
 * Change it immediately after first login via Settings → Change Password.
 */
const bcrypt = require('bcryptjs');
const User   = require('../models/User');

async function initAdmin() {
  const count = await User.countDocuments();
  if (count > 0) return; // users already exist — nothing to do

  const rawPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
  const hashed      = await bcrypt.hash(rawPassword, 12);

  await User.create({
    name:     'Admin IINVSYS',
    email:    (process.env.ADMIN_EMAIL || 'admin@iinvsys.com').toLowerCase(),
    password: hashed,
    role:     'superadmin',
    isActive: true,
  });

  console.log('✅  Auto-init: superadmin account created');
  console.log(`    Email   : ${process.env.ADMIN_EMAIL || 'admin@iinvsys.com'}`);
  console.log('    Password: (set via ADMIN_PASSWORD env var, default Admin@123)');
  console.log('    ⚠️  Change the password immediately after first login!\n');
}

module.exports = initAdmin;
