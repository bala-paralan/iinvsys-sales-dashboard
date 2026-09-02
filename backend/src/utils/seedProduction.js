'use strict';
/**
 * seedProduction — wipes ALL data and creates only the superadmin account.
 * Use this to reset the database to a clean production state.
 *
 * Usage:
 *   cd backend
 *   node src/utils/seedProduction.js
 *
 * Environment variables (optional overrides):
 *   ADMIN_EMAIL     default: admin@iinvsys.com
 *   ADMIN_PASSWORD  required in production; otherwise a random one is generated
 *                   and printed once.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { generatePassword } = require('./initAdmin');

const User    = require('../models/User');
const Customer = require('../models/Customer');
const Activity = require('../models/Activity');
const Task     = require('../models/Task');
const Approval = require('../models/Approval');
const CoachingNote = require('../models/CoachingNote');
const Product = require('../models/Product');
const Expo    = require('../models/Expo');
const Lead    = require('../models/Lead');
const connectDB = require('../config/db');

async function seedProduction() {
  await connectDB();

  /*
   * REFUSE TO WIPE A DATABASE THAT HAS ANYTHING IN IT.
   *
   * This script destroys every collection. On a fresh greenfield database that is a
   * no-op, which is the only case it is meant for. Run with MONGO_DB still pointing at
   * the previous version — the exact mistake a cutover invites — and it silently
   * destroys production instead.
   *
   * Note that a greenfield cutover does not need this script at all: utils/initAdmin.js
   * bootstraps the superadmin on any empty database at boot. This guard exists because
   * the command is here and someone will reach for it.
   */
  const mongoose = require('mongoose');
  const dbName = mongoose.connection.name;
  const existingUsers = await User.countDocuments();

  if (existingUsers > 0 && process.env.SEED_CONFIRM_WIPE !== dbName) {
    throw new Error(
      `Refusing to wipe "${dbName}": it already holds ${existingUsers} user(s).\n`
      + `If you genuinely mean to destroy it, re-run with SEED_CONFIRM_WIPE=${dbName}.\n`
      + 'For a greenfield cutover, point MONGO_DB at a NEW database instead — the API '
      + 'bootstraps its own superadmin on an empty one.',
    );
  }

  console.log(`\n🗑️   Wiping all collections in "${dbName}" …`);

  await Promise.all([
    User.deleteMany({}),
    Customer.deleteMany({}),
    Activity.deleteMany({}),
    Task.deleteMany({}),
    Approval.deleteMany({}),
    CoachingNote.deleteMany({}),
    Product.deleteMany({}),
    Expo.deleteMany({}),
    Lead.deleteMany({}),
  ]);
  console.log('    All collections cleared.\n');

  const email = (process.env.ADMIN_EMAIL || 'admin@iinvsys.com').toLowerCase();

  let rawPassword = process.env.ADMIN_PASSWORD;
  if (!rawPassword) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ADMIN_PASSWORD must be set when seeding a production database. ' +
        'Refusing to create an account with a default password.'
      );
    }
    rawPassword = generatePassword();
  }

  /* Pass plain-text — the User pre('save') hook hashes it. Pre-hashing here
     double-hashes, and the printed password then never authenticates. */
  await User.create({
    name:     'Admin IINVSYS',
    email,
    password: rawPassword,
    role:     'superadmin',
    isActive: true,
  });

  console.log('✅  Production seed complete!\n');
  console.log('   Superadmin credentials:');
  console.log(`   Email   : ${email}`);
  console.log(`   Password: ${rawPassword}`);
  console.log('\n   ⚠️  Change the password immediately after first login!\n');

  await mongoose.disconnect();
}

seedProduction().catch(err => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
